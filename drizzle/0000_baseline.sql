CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` text NOT NULL,
	`direction` text NOT NULL,
	`message` text NOT NULL,
	`classification_ok` integer NOT NULL,
	`flagged` integer,
	`category` text,
	`reason` text,
	`error` text,
	`action` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_contact_idx` ON `audit_log` (`contact_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_contact_cursor_idx` ON `audit_log` (`contact_id`,`id`);--> statement-breakpoint
CREATE TABLE `blocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` text NOT NULL,
	`blocked_at` integer NOT NULL,
	`unblock_at` integer NOT NULL,
	`unblocked_at` integer
);
--> statement-breakpoint
CREATE INDEX `blocks_pending_idx` ON `blocks` (`contact_id`,`unblocked_at`);--> statement-breakpoint
CREATE INDEX `blocks_expiry_idx` ON `blocks` (`unblocked_at`,`unblock_at`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`contact_id` text PRIMARY KEY NOT NULL,
	`name` text,
	`notify` text,
	`verified_name` text,
	`lid` text,
	`updated_at` integer NOT NULL,
	`last_message_at` integer,
	`photo_url` text,
	`photo_fetched_at` integer
);
--> statement-breakpoint
CREATE TABLE `monitored_contacts` (
	`contact_id` text PRIMARY KEY NOT NULL,
	`escalation_enabled` integer DEFAULT 1 NOT NULL,
	`added_at` integer NOT NULL,
	`context` text
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `strikes` (
	`contact_id` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
