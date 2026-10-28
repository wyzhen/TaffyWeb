CREATE TABLE `video_upload_parts` (
	`memory_id` text NOT NULL,
	`part_number` integer NOT NULL,
	`etag` text NOT NULL,
	`byte_size` integer NOT NULL,
	PRIMARY KEY(`memory_id`, `part_number`)
);
--> statement-breakpoint
CREATE TABLE `video_uploads` (
	`memory_id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`upload_id` text NOT NULL,
	`metadata` text NOT NULL,
	`byte_size` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `video_uploads_expiry_idx` ON `video_uploads` (`expires_at`);