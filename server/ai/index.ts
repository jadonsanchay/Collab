import type { Server } from 'socket.io';

import { CANVAS_SIZE } from '@/common/constants/canvasSize';
import type {
  AiKind,
  AiRequest,
  AiStatus,
  AiStatusUpdate,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/common/types/global';

import type { BoardStore } from '../boards/BoardStore';
import type { Config } from '../config';
import { logger } from '../logger';
import type { SocketData } from '../socket/identity';
import { createAnthropicAgent } from './agent';
import { createFakeAgent } from './fakeAgent';
import { createOpenAiAgent } from './openaiAgent';
import {
  interpret,
  placeTarget,
  type Timing,
} from './interpreter';
import { createLimits, type LimitOptions } from './limits';
import { JobQueue, type QueueOptions } from './queue';
import { SketchParticipant, type ParticipantOptions } from './participant';
import type { SketchAgent } from './types';

type IOServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export type AiServiceOptions = {
  /** Overrides the agent chosen from config. Tests inject fakes here. */
  agent?: SketchAgent;
  limits?: Partial<LimitOptions>;
  queue?: Partial<QueueOptions>;
  timing?: Partial<Timing>;
  participant?: Partial<ParticipantOptions>;
};

type JobRecord = {
  requestId: string;
  roomId: string;
  userId: string;
  kind: AiKind;
  createdAt: number;
};

/** Records older than this are forgotten; their moves stay, undo is gone. */
const JOB_MEMORY_MS = 60 * 60_000;

/** Recent chat kept per room for `summarize`. */
const CHAT_MEMORY = 50;

const center = (rect: { x: number; y: number; width: number; height: number }) =>
  [rect.x + rect.width / 2, rect.y + rect.height / 2] as [number, number];

/**
 * An explicit `AI_PROVIDER` wins; otherwise whichever key is present, with
 * Anthropic first when both are. A provider named without its key is a
 * configuration mistake and yields no agent rather than a surprise.
 */
const detectProvider = (config: Config): Config['AI_PROVIDER'] => {
  if (config.ANTHROPIC_API_KEY) return 'anthropic';
  if (config.OPENAI_API_KEY) return 'openai';

  return undefined;
};

export const pickProviderAgent = (config: Config): SketchAgent | null => {
  const provider = config.AI_PROVIDER ?? detectProvider(config);

  if (provider === 'anthropic' && config.ANTHROPIC_API_KEY) {
    return createAnthropicAgent({ apiKey: config.ANTHROPIC_API_KEY, model: config.AI_MODEL });
  }

  if (provider === 'openai' && config.OPENAI_API_KEY) {
    return createOpenAiAgent({ apiKey: config.OPENAI_API_KEY, model: config.OPENAI_MODEL });
  }

  return null;
};

export const createAiService = ({
  io,
  boards: rooms,
  config,
  options = {},
}: {
  io: IOServer;
  /** Moves go through the board store so Sketch's work is persisted too. */
  boards: BoardStore;
  config: Config;
  options?: AiServiceOptions;
}) => {
  if (!config.AI_ENABLED) return null;

  let agent: SketchAgent | null = options.agent ?? null;

  // The fake wins when both are set: nobody wants a test run to spend money.
  if (!agent && config.AI_FAKE) agent = createFakeAgent();

  if (!agent) agent = pickProviderAgent(config);

  if (!agent) {
    logger.warn(
      'AI_ENABLED is set but no agent is available (set ANTHROPIC_API_KEY or OPENAI_API_KEY, or AI_FAKE=1); AI disabled',
    );

    return null;
  }

  const limits = createLimits(options.limits);
  const queue = new JobQueue(options.queue);
  const participant = new SketchParticipant(io, rooms, options.participant);
  const jobs = new Map<string, JobRecord>();
  const chat = new Map<string, string[]>();

  logger.info({ agent: agent.name }, 'AI teammate enabled');

  const emitStatus = (
    job: JobRecord,
    status: AiStatus,
    message?: string,
    progress?: { done: number; total: number },
  ) => {
    const update: AiStatusUpdate = {
      requestId: job.requestId,
      userId: job.userId,
      kind: job.kind,
      status,
      ...(message ? { message } : {}),
      ...(progress ? { progress } : {}),
    };

    io.to(job.roomId).emit('ai_status', update);
  };

  const forgetOldJobs = (now = Date.now()) => {
    jobs.forEach((job, id) => {
      if (now - job.createdAt > JOB_MEMORY_MS) jobs.delete(id);
    });
  };

  const run = async (
    job: JobRecord,
    request: AiRequest,
    target: NonNullable<ReturnType<typeof placeTarget>>,
    signal: AbortSignal,
  ) => {
    const startedAt = Date.now();

    try {
      emitStatus(job, 'thinking');
      // The pen heads for where the drawing will land while the model works,
      // so the room sees something happen well before the first shape.
      participant.moveCursor(job.roomId, center(target));

      const result = await agent.generate(
        {
          kind: job.kind,
          prompt: request.prompt,
          imageBase64: request.image,
          recentChat: chat.get(job.roomId) ?? [],
        },
        signal,
      );

      if (signal.aborted) return;

      if (result.status === 'refused') {
        emitStatus(job, 'refused', result.message);
        return;
      }

      if (result.status === 'error') {
        emitStatus(job, 'error', result.message);
        return;
      }

      const planned = interpret(result.program, target, CANVAS_SIZE, options.timing);
      const { note } = result.program;

      logger.info(
        {
          requestId: job.requestId,
          roomId: job.roomId,
          kind: job.kind,
          primitives: result.program.primitives.length,
          moves: planned.length,
          ...(result.usage ?? {}),
          modelMs: Date.now() - startedAt,
        },
        'ai program received',
      );

      if (planned.length) {
        emitStatus(job, 'drawing', undefined, { done: 0, total: planned.length });

        await participant.animate(
          job.roomId,
          job.requestId,
          planned,
          signal,
          (done, total) =>
            emitStatus(job, 'drawing', `drawing ${done} of ${total}`, {
              done,
              total,
            }),
        );

        if (signal.aborted) return;
      }

      if (note && participant.isPresent(job.roomId)) participant.say(job.roomId, note);

      emitStatus(job, 'done', note);

      logger.info(
        { requestId: job.requestId, roomId: job.roomId, durationMs: Date.now() - startedAt },
        'ai job done',
      );
    } catch (error) {
      logger.error({ err: error, requestId: job.requestId }, 'ai job failed');
      emitStatus(job, 'error', 'Sketch ran into a problem and stopped.');
    }
  };

  return {
    agentName: agent.name,

    /** Remembers a chat line so `summarize` has context. */
    noteChat(roomId: string, author: string, text: string) {
      const lines = chat.get(roomId) ?? [];
      lines.push(`${author}: ${text}`);
      chat.set(roomId, lines.slice(-CHAT_MEMORY));
    },

    async request(
      context: { roomId: string; userId: string },
      request: AiRequest,
    ) {
      forgetOldJobs();

      // A resend of a request already seen is ignored, like a duplicate move.
      if (jobs.has(request.requestId)) return;

      const job: JobRecord = {
        requestId: request.requestId,
        roomId: context.roomId,
        userId: context.userId,
        kind: request.kind,
        createdAt: Date.now(),
      };

      jobs.set(job.requestId, job);

      if (!(await limits.allowRoomRequest(job.roomId))) {
        emitStatus(
          job,
          'rate_limited',
          'Sketch has done a lot in this room recently. Try again in a few minutes.',
        );
        return;
      }

      const target = placeTarget(job.kind, request, CANVAS_SIZE);

      if (!target) {
        emitStatus(job, 'error', 'Select an area of the board first.');
        return;
      }

      if (!participant.ensure(job.roomId)) return;

      // Accepted. Sent before enqueueing because a free slot starts the job
      // synchronously, and `thinking` must not overtake this.
      emitStatus(job, 'queued');

      const queued = queue.enqueue({
        id: job.requestId,
        run: (signal) => run(job, request, target, signal),
        onTimeout: () =>
          emitStatus(job, 'error', 'Sketch took too long and gave up.'),
      });

      if (queued === 'full') {
        emitStatus(job, 'rate_limited', 'Sketch is busy right now. Try again shortly.');
      }
    },

    /**
     * Removes every move a request produced, on every client, as one action.
     * Only the requester may undo their request. A job still running is
     * aborted first so the pen stops.
     */
    undo(roomId: string, userId: string, requestId: string): boolean {
      const job = jobs.get(requestId);

      if (!job || job.roomId !== roomId || job.userId !== userId) return false;

      queue.abort(requestId);

      const room = rooms.get(roomId);

      if (!room) return false;

      const ids: string[] = [];

      room.usersMoves.forEach((moves) => {
        moves.forEach((move) => {
          if (move.meta?.requestId === requestId) ids.push(move.id);
        });
      });

      room.drawed.forEach((move) => {
        if (move.meta?.requestId === requestId) ids.push(move.id);
      });

      if (!ids.length) return false;

      rooms.removeMoves(roomId, ids);
      io.to(roomId).emit('moves_removed', ids);

      return true;
    },

    stop() {
      queue.stop();
      participant.stop();
    },
  };
};

export type AiService = NonNullable<ReturnType<typeof createAiService>>;
