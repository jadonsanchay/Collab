CREATE TABLE "board_doc_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"user_id" text,
	"update" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_docs" (
	"board_id" text PRIMARY KEY NOT NULL,
	"state" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_doc_updates" ADD CONSTRAINT "board_doc_updates_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_docs" ADD CONSTRAINT "board_docs_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_doc_updates_board_seq_idx" ON "board_doc_updates" USING btree ("board_id","seq");