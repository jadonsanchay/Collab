import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { pickProviderAgent } from './index';

const base = loadConfig({ DEFAULT_ENGINE: 'raster' });

describe('pickProviderAgent', () => {
  it('uses Anthropic when only that key is present', () => {
    expect(pickProviderAgent({ ...base, ANTHROPIC_API_KEY: 'a' })?.name).toBe(
      'anthropic:claude-opus-5-5',
    );
  });

  it('uses OpenAI when only that key is present', () => {
    expect(pickProviderAgent({ ...base, OPENAI_API_KEY: 'o' })?.name).toBe('openai:gpt-5.5');
  });

  it('prefers Anthropic when both keys are present, unless told otherwise', () => {
    const both = { ...base, ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' };

    expect(pickProviderAgent(both)?.name).toMatch(/^anthropic:/);
    expect(pickProviderAgent({ ...both, AI_PROVIDER: 'openai' })?.name).toMatch(/^openai:/);
  });

  it('honours the model overrides', () => {
    expect(
      pickProviderAgent({ ...base, OPENAI_API_KEY: 'o', OPENAI_MODEL: 'gpt-5.4-mini' })?.name,
    ).toBe('openai:gpt-5.4-mini');
    expect(
      pickProviderAgent({ ...base, ANTHROPIC_API_KEY: 'a', AI_MODEL: 'claude-sonnet-5-5' })?.name,
    ).toBe('anthropic:claude-sonnet-5-5');
  });

  it('yields no agent when the named provider has no key, or no key exists', () => {
    expect(pickProviderAgent({ ...base, AI_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'a' })).toBeNull();
    expect(pickProviderAgent(base)).toBeNull();
  });

  it('parses the provider from the environment', () => {
    expect(loadConfig({ AI_PROVIDER: 'openai' }).AI_PROVIDER).toBe('openai');
    expect(() => loadConfig({ AI_PROVIDER: 'gemini' })).toThrow(/AI_PROVIDER/);
    expect(loadConfig({ AI_ENABLED: 'true', AI_FAKE: '1' })).toMatchObject({
      AI_ENABLED: true,
      AI_FAKE: true,
    });
  });
});
