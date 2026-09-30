-- Costs and stock. Views and child tables go first so the rebuilt tables can be renamed into place.
DROP VIEW `job_details`;
--> statement-breakpoint
DROP TABLE `media_stock_mappings`;
--> statement-breakpoint
DROP TABLE `paper_prices`;
--> statement-breakpoint
DROP TABLE `ink_prices`;
--> statement-breakpoint
CREATE TABLE `papers` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	CONSTRAINT "papers_name_check" CHECK(length(trim(name)) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `papers_name_unique` ON `papers` (`name`);
--> statement-breakpoint
CREATE TABLE `paper_media_types` (
	`paper_id` integer NOT NULL,
	`source_media_id` text NOT NULL,
	PRIMARY KEY(`paper_id`, `source_media_id`),
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `paper_media_types_media` ON `paper_media_types` (`source_media_id`);
--> statement-breakpoint
-- Earlier stock rows had no paper; none exist in any ledger, and a stray one fails this migration.
CREATE TABLE `__new_paper_stocks` (
	`id` integer PRIMARY KEY NOT NULL,
	`paper_id` integer NOT NULL,
	`name` text NOT NULL,
	`format` text NOT NULL,
	`width_um` integer NOT NULL,
	`height_um` integer,
	`deckle` integer DEFAULT 0 NOT NULL,
	`product_code` text,
	`notes` text,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "paper_stocks_name_check" CHECK(length(trim(name)) > 0),
	CONSTRAINT "paper_stocks_format_check" CHECK(format IN ('sheet','roll')),
	CONSTRAINT "paper_stocks_width_um_check" CHECK(width_um > 0),
	CONSTRAINT "paper_stocks_height_um_check" CHECK(CASE format WHEN 'sheet' THEN typeof(height_um)='integer' AND height_um > 0 ELSE height_um IS NULL AND deckle=0 END),
	CONSTRAINT "paper_stocks_deckle_check" CHECK(deckle IN (0,1))
);
--> statement-breakpoint
INSERT INTO `__new_paper_stocks`(id, paper_id, name, format, width_um, height_um, product_code, notes)
  SELECT id, NULL, name, format, width_um, height_um, product_code, notes FROM `paper_stocks`;
--> statement-breakpoint
-- A sheet count and a stored paper cost are obsolete: usage is printer-reported and costs are calculated.
CREATE TABLE `__new_job_annotations` (
	`job_id` integer PRIMARY KEY NOT NULL,
	`custom_paper_name` text,
	`paper_stock_id` integer,
	`paper_id` integer,
	`hidden` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `print_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`paper_stock_id`) REFERENCES `paper_stocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "job_annotations_custom_paper_name_check" CHECK(custom_paper_name IS NULL OR length(trim(custom_paper_name)) > 0),
	CONSTRAINT "job_annotations_hidden_check" CHECK(hidden IN (0,1))
);
--> statement-breakpoint
INSERT INTO `__new_job_annotations`(job_id, custom_paper_name, paper_stock_id, hidden, notes, updated_at)
  SELECT job_id, custom_paper_name, paper_stock_id, hidden, notes, updated_at FROM `job_annotations`;
--> statement-breakpoint
DROP TABLE `job_annotations`;
--> statement-breakpoint
ALTER TABLE `__new_job_annotations` RENAME TO `job_annotations`;
--> statement-breakpoint
DROP TABLE `paper_stocks`;
--> statement-breakpoint
ALTER TABLE `__new_paper_stocks` RENAME TO `paper_stocks`;
--> statement-breakpoint
CREATE TABLE `paper_purchases` (
	`id` integer PRIMARY KEY NOT NULL,
	`paper_stock_id` integer NOT NULL,
	`purchased_on` text NOT NULL,
	`packs` integer,
	`sheets_per_pack` integer,
	`length_um` integer,
	`price_micros` integer NOT NULL,
	FOREIGN KEY (`paper_stock_id`) REFERENCES `paper_stocks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "paper_purchases_purchased_on_check" CHECK(length(purchased_on)=10 AND date(purchased_on) IS NOT NULL AND date(purchased_on)=purchased_on),
	CONSTRAINT "paper_purchases_quantity_check" CHECK(CASE WHEN length_um IS NULL THEN typeof(packs)='integer' AND packs > 0 AND typeof(sheets_per_pack)='integer' AND sheets_per_pack > 0
    ELSE packs IS NULL AND sheets_per_pack IS NULL AND typeof(length_um)='integer' AND length_um > 0 END),
	CONSTRAINT "paper_purchases_price_micros_check" CHECK(typeof(price_micros)='integer' AND price_micros >= 0)
);
--> statement-breakpoint
CREATE TABLE `ink_purchases` (
	`id` integer PRIMARY KEY NOT NULL,
	`ink_product_id` integer NOT NULL,
	`purchased_on` text NOT NULL,
	`cartridges` integer NOT NULL,
	`price_micros` integer NOT NULL,
	FOREIGN KEY (`ink_product_id`) REFERENCES `ink_products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ink_purchases_purchased_on_check" CHECK(length(purchased_on)=10 AND date(purchased_on) IS NOT NULL AND date(purchased_on)=purchased_on),
	CONSTRAINT "ink_purchases_cartridges_check" CHECK(typeof(cartridges)='integer' AND cartridges > 0),
	CONSTRAINT "ink_purchases_price_micros_check" CHECK(typeof(price_micros)='integer' AND price_micros >= 0)
);
--> statement-breakpoint
CREATE TABLE `stock_write_offs` (
	`id` integer PRIMARY KEY NOT NULL,
	`paper_stock_id` integer,
	`ink_product_id` integer,
	`written_off_on` text NOT NULL,
	`quantity` integer,
	`all_remaining` integer DEFAULT 0 NOT NULL,
	`reason` text,
	FOREIGN KEY (`paper_stock_id`) REFERENCES `paper_stocks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ink_product_id`) REFERENCES `ink_products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stock_write_offs_target_check" CHECK((paper_stock_id IS NULL) <> (ink_product_id IS NULL)),
	CONSTRAINT "stock_write_offs_written_off_on_check" CHECK(length(written_off_on)=10 AND date(written_off_on) IS NOT NULL AND date(written_off_on)=written_off_on),
	CONSTRAINT "stock_write_offs_all_remaining_check" CHECK(all_remaining IN (0,1)),
	CONSTRAINT "stock_write_offs_quantity_check" CHECK(CASE all_remaining WHEN 1 THEN quantity IS NULL ELSE typeof(quantity)='integer' AND quantity > 0 END),
	CONSTRAINT "stock_write_offs_reason_check" CHECK(reason IS NULL OR length(trim(reason)) > 0)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`costing_method` text DEFAULT 'oldest' NOT NULL,
	`currency` text DEFAULT 'GBP' NOT NULL,
	CONSTRAINT "settings_id_check" CHECK(id = 1),
	CONSTRAINT "settings_costing_method_check" CHECK(costing_method IN ('oldest','average','max')),
	CONSTRAINT "settings_currency_check" CHECK(length(currency)=3 AND currency NOT GLOB '*[^A-Z]*')
);
--> statement-breakpoint
INSERT INTO `settings`(id) VALUES (1);
--> statement-breakpoint
CREATE VIEW `job_details` AS SELECT j.id AS job_id, j.printer_id, j.source_record_id,
       j.first_seen_at, j.last_seen_at,
       o.job_name, o.job_owner, o.started_at_raw, o.completed_at_raw,
       o.completion_state, o.job_type, o.width_um, o.height_um, o.used_area_mm2,
       o.impressions, o.color_pages, o.monochrome_pages, o.duplex,
       m.source_media_id, r.english_name AS configured_paper_name,
       o.resolved_media_name AS paper_name_at_import,
       COALESCE(a.custom_paper_name, r.english_name, r.short_name,
                o.resolved_media_name) AS display_paper_name,
       COALESCE(a.hidden, 0) AS hidden, a.custom_paper_name,
       a.paper_stock_id AS stock_override_id, a.paper_id AS paper_override_id, a.notes,
       CASE WHEN EXISTS(SELECT 1 FROM print_jobs other
                        WHERE other.printer_id=j.printer_id
                          AND other.source_record_id=j.source_record_id
                          AND other.id<>j.id) THEN 1 ELSE 0 END AS record_id_collision
FROM print_jobs j
JOIN job_observations o ON o.id=j.current_observation_id
LEFT JOIN media_configs m ON m.id=o.media_config_id
LEFT JOIN media_revisions r ON r.id=m.current_revision_id
LEFT JOIN job_annotations a ON a.job_id=j.id;
