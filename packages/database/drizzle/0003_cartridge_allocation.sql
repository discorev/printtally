ALTER TABLE `printers` ADD `identified_at` text;--> statement-breakpoint
ALTER TABLE `stock_write_offs` ADD `printer_id` integer REFERENCES `printers`(`id`) CONSTRAINT "stock_write_offs_printer_check" CHECK (`printer_id` IS NULL OR (`ink_product_id` IS NOT NULL AND `all_remaining`=1));--> statement-breakpoint
CREATE TABLE `ink_fittings` (
  `id` integer PRIMARY KEY NOT NULL,
  `printer_id` integer NOT NULL REFERENCES `printers`(`id`),
  `channel` text NOT NULL,
  `ink_purchase_id` integer NOT NULL REFERENCES `ink_purchases`(`id`),
  `after_record` integer NOT NULL,
  `replaced` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT "ink_fittings_channel_check" CHECK(length(channel) BETWEEN 1 AND 16 AND channel NOT GLOB '*[^A-Za-z0-9_]*'),
  CONSTRAINT "ink_fittings_after_record_check" CHECK(after_record >= -1),
  CONSTRAINT "ink_fittings_replaced_check" CHECK(replaced IN ('shelf','used'))
);--> statement-breakpoint
CREATE INDEX `ink_fittings_position_idx` ON `ink_fittings` (`printer_id`,`channel`,`after_record`);
