CREATE TABLE `favorites` (
	`memory_id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`memory_date` text NOT NULL,
	`body` text NOT NULL,
	`location` text NOT NULL,
	`object_key` text,
	`mime` text,
	`byte_size` integer DEFAULT 0 NOT NULL,
	`filename` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memories_date_idx` ON `memories` (`memory_date`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
