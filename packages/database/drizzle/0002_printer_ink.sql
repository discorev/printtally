CREATE TABLE `printer_ink_readings` (
  `id` integer PRIMARY KEY NOT NULL,
  `printer_id` integer NOT NULL,
  `channel` text NOT NULL,
  `series` text,
  `level` integer,
  `replacement_count` integer,
  `first_seen_at` text NOT NULL,
  `last_seen_at` text NOT NULL,
  FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "printer_ink_readings_channel_check" CHECK(length(channel) BETWEEN 1 AND 16 AND channel NOT GLOB '*[^A-Za-z0-9_]*'),
  CONSTRAINT "printer_ink_readings_level_check" CHECK(level IS NULL OR level BETWEEN 0 AND 100),
  CONSTRAINT "printer_ink_readings_count_check" CHECK(replacement_count IS NULL OR replacement_count >= 0)
);
--> statement-breakpoint
CREATE INDEX `printer_ink_readings_latest_idx` ON `printer_ink_readings` (`printer_id`,`channel`,`first_seen_at`);--> statement-breakpoint
ALTER TABLE `printers` ADD `firmware` text;
