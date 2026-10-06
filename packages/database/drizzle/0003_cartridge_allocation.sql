CREATE TABLE `ink_fittings` (
	`id` integer PRIMARY KEY NOT NULL,
	`printer_id` integer NOT NULL,
	`channel` text NOT NULL,
	`ink_purchase_id` integer NOT NULL,
	`after_record` integer NOT NULL,
	`replaced` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ink_purchase_id`) REFERENCES `ink_purchases`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ink_fittings_channel_check" CHECK(length(channel) BETWEEN 1 AND 16 AND channel NOT GLOB '*[^A-Za-z0-9_]*'),
	CONSTRAINT "ink_fittings_after_record_check" CHECK(after_record >= -1),
	CONSTRAINT "ink_fittings_replaced_check" CHECK(replaced IN ('shelf','used'))
);
--> statement-breakpoint
CREATE INDEX `ink_fittings_position_idx` ON `ink_fittings` (`printer_id`,`channel`,`after_record`);--> statement-breakpoint
ALTER TABLE `printers` ADD `identified_at` text;--> statement-breakpoint
UPDATE `printers` SET `identified_at` = `last_seen_at` WHERE `model` IS NOT NULL OR `firmware` IS NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_stock_write_offs` (
	`id` integer PRIMARY KEY NOT NULL,
	`paper_stock_id` integer,
	`ink_product_id` integer,
	`printer_id` integer,
	`written_off_on` text NOT NULL,
	`quantity` integer,
	`all_remaining` integer DEFAULT 0 NOT NULL,
	`reason` text,
	FOREIGN KEY (`paper_stock_id`) REFERENCES `paper_stocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ink_product_id`) REFERENCES `ink_products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stock_write_offs_printer_check" CHECK(printer_id IS NULL OR (ink_product_id IS NOT NULL AND all_remaining=1)),
	CONSTRAINT "stock_write_offs_target_check" CHECK((paper_stock_id IS NULL) <> (ink_product_id IS NULL)),
	CONSTRAINT "stock_write_offs_written_off_on_check" CHECK(length(written_off_on)=10 AND date(written_off_on) IS NOT NULL AND date(written_off_on)=written_off_on),
	CONSTRAINT "stock_write_offs_all_remaining_check" CHECK(all_remaining IN (0,1)),
	CONSTRAINT "stock_write_offs_quantity_check" CHECK(CASE all_remaining WHEN 1 THEN quantity IS NULL ELSE typeof(quantity)='integer' AND quantity > 0 END),
	CONSTRAINT "stock_write_offs_reason_check" CHECK(reason IS NULL OR length(trim(reason)) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_stock_write_offs`("id", "paper_stock_id", "ink_product_id", "printer_id", "written_off_on", "quantity", "all_remaining", "reason") SELECT "id", "paper_stock_id", "ink_product_id", NULL, "written_off_on", "quantity", "all_remaining", "reason" FROM `stock_write_offs`;--> statement-breakpoint
DROP TABLE `stock_write_offs`;--> statement-breakpoint
ALTER TABLE `__new_stock_write_offs` RENAME TO `stock_write_offs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;