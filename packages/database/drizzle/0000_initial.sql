CREATE TABLE `import_job_observations` (
	`import_id` integer NOT NULL,
	`job_id` integer NOT NULL,
	`observation_id` integer NOT NULL,
	PRIMARY KEY(`import_id`, `job_id`),
	FOREIGN KEY (`import_id`) REFERENCES `import_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `print_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`,`observation_id`) REFERENCES `job_observations`(`job_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `import_runs` (
	`id` integer PRIMARY KEY NOT NULL,
	`printer_id` integer,
	`source` text NOT NULL,
	`source_host` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`observed_at` text,
	`requested_first` integer,
	`requested_last` integer,
	`received_count` integer,
	`new_jobs` integer,
	`new_observations` integer,
	`record_id_collisions` integer,
	`schema_json` text,
	`error_code` text,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "import_runs_source_check" CHECK(source IN ('live','snapshot')),
	CONSTRAINT "import_runs_status_check" CHECK(status IN ('running','succeeded','failed')),
	CONSTRAINT "import_runs_schema_json_check" CHECK(schema_json IS NULL OR json_valid(schema_json))
);
--> statement-breakpoint
CREATE TABLE `ink_prices` (
	`id` integer PRIMARY KEY NOT NULL,
	`ink_product_id` integer NOT NULL,
	`effective_from` text NOT NULL,
	`currency` text NOT NULL,
	`amount_micros` integer NOT NULL,
	`cartridge_count` integer DEFAULT 1 NOT NULL,
	`notes` text,
	FOREIGN KEY (`ink_product_id`) REFERENCES `ink_products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ink_prices_effective_from_check" CHECK(length(effective_from)=10 AND date(effective_from) IS NOT NULL AND date(effective_from)=effective_from),
	CONSTRAINT "ink_prices_currency_check" CHECK(length(currency)=3 AND currency NOT GLOB '*[^A-Z]*'),
	CONSTRAINT "ink_prices_amount_micros_check" CHECK(typeof(amount_micros)='integer' AND amount_micros >= 0),
	CONSTRAINT "ink_prices_cartridge_count_check" CHECK(typeof(cartridge_count)='integer' AND cartridge_count > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ink_prices_ink_product_id_currency_effective_from_unique` ON `ink_prices` (`ink_product_id`,`currency`,`effective_from`);--> statement-breakpoint
CREATE TABLE `ink_products` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`channel` text NOT NULL,
	`capacity_nl` integer NOT NULL,
	`product_code` text,
	CONSTRAINT "ink_products_name_check" CHECK(length(trim(name)) > 0),
	CONSTRAINT "ink_products_capacity_nl_check" CHECK(capacity_nl > 0)
);
--> statement-breakpoint
CREATE TABLE `job_annotations` (
	`job_id` integer PRIMARY KEY NOT NULL,
	`custom_paper_name` text,
	`paper_stock_id` integer,
	`hidden` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`physical_sheet_count` integer,
	`paper_cost_override_micros` integer,
	`paper_cost_currency` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `print_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`paper_stock_id`) REFERENCES `paper_stocks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "job_annotations_custom_paper_name_check" CHECK(custom_paper_name IS NULL OR length(trim(custom_paper_name)) > 0),
	CONSTRAINT "job_annotations_hidden_check" CHECK(hidden IN (0,1)),
	CONSTRAINT "job_annotations_physical_sheet_count_check" CHECK(physical_sheet_count >= 0),
	CONSTRAINT "job_annotations_paper_cost_override_micros_check" CHECK(paper_cost_override_micros IS NULL OR (typeof(paper_cost_override_micros)='integer' AND paper_cost_override_micros >= 0)),
	CONSTRAINT "job_annotations_paper_cost_currency_check" CHECK(length(paper_cost_currency)=3 AND paper_cost_currency NOT GLOB '*[^A-Z]*'),
	CONSTRAINT "job_annotations_paper_cost_check" CHECK((paper_cost_override_micros IS NULL) = (paper_cost_currency IS NULL))
);
--> statement-breakpoint
CREATE TABLE `job_cost_adjustments` (
	`id` integer PRIMARY KEY NOT NULL,
	`job_id` integer NOT NULL,
	`description` text NOT NULL,
	`amount_micros` integer NOT NULL,
	`currency` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `print_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "job_cost_adjustments_description_check" CHECK(length(trim(description)) > 0),
	CONSTRAINT "job_cost_adjustments_amount_micros_check" CHECK(typeof(amount_micros)='integer'),
	CONSTRAINT "job_cost_adjustments_currency_check" CHECK(length(currency)=3 AND currency NOT GLOB '*[^A-Z]*')
);
--> statement-breakpoint
CREATE TABLE `job_ink_usage` (
	`observation_id` integer NOT NULL,
	`channel` text NOT NULL,
	`volume_nl` integer,
	PRIMARY KEY(`observation_id`, `channel`),
	FOREIGN KEY (`observation_id`) REFERENCES `job_observations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "job_ink_usage_volume_nl_check" CHECK(volume_nl >= 0)
);
--> statement-breakpoint
CREATE TABLE `job_observations` (
	`id` integer PRIMARY KEY NOT NULL,
	`job_id` integer NOT NULL,
	`content_hash` text NOT NULL,
	`first_import_id` integer NOT NULL,
	`first_observed_at` text NOT NULL,
	`last_observed_at` text NOT NULL,
	`raw_json` text NOT NULL,
	`media_config_id` integer,
	`resolved_media_name` text,
	`job_name` text,
	`job_owner` text,
	`started_at_raw` text,
	`completed_at_raw` text,
	`completion_state` text,
	`job_type` text,
	`width_um` integer,
	`height_um` integer,
	`used_area_mm2` integer,
	`impressions` integer,
	`color_pages` integer,
	`monochrome_pages` integer,
	`duplex` text,
	FOREIGN KEY (`job_id`) REFERENCES `print_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`first_import_id`) REFERENCES `import_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_config_id`) REFERENCES `media_configs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "job_observations_raw_json_check" CHECK(json_valid(raw_json)),
	CONSTRAINT "job_observations_width_um_check" CHECK(width_um >= 0),
	CONSTRAINT "job_observations_height_um_check" CHECK(height_um >= 0),
	CONSTRAINT "job_observations_used_area_mm2_check" CHECK(used_area_mm2 >= 0),
	CONSTRAINT "job_observations_impressions_check" CHECK(impressions >= 0),
	CONSTRAINT "job_observations_color_pages_check" CHECK(color_pages >= 0),
	CONSTRAINT "job_observations_monochrome_pages_check" CHECK(monochrome_pages >= 0)
);
--> statement-breakpoint
CREATE INDEX `jobs_started` ON `job_observations` (`started_at_raw`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_observations_job_id_content_hash_unique` ON `job_observations` (`job_id`,`content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_observations_job_id_id_unique` ON `job_observations` (`job_id`,`id`);--> statement-breakpoint
CREATE TABLE `known_printers` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text NOT NULL,
	`name` text NOT NULL,
	`mac` text,
	`root_certificate_pem` text NOT NULL,
	`root_fingerprint_sha256` text NOT NULL,
	`root_valid_from` text NOT NULL,
	`root_valid_to` text NOT NULL,
	`confirmed_at` text NOT NULL,
	`last_verified_at` text NOT NULL,
	CONSTRAINT "known_printers_mac_check" CHECK(mac IS NULL OR (length(mac)=12 AND mac NOT GLOB '*[^0-9a-f]*'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `known_printers_host_unique` ON `known_printers` (`host`);--> statement-breakpoint
CREATE UNIQUE INDEX `known_printers_root_fingerprint_sha256_unique` ON `known_printers` (`root_fingerprint_sha256`);--> statement-breakpoint
CREATE TABLE `media_configs` (
	`id` integer PRIMARY KEY NOT NULL,
	`printer_id` integer NOT NULL,
	`source_media_id` text NOT NULL,
	`present_on_printer` integer,
	`visible` integer,
	`current_revision_id` integer,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`id`,`current_revision_id`) REFERENCES `media_revisions`(`media_id`,`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED, -- Added by hand: Drizzle cannot declare DEFERRABLE.
	CONSTRAINT "media_configs_present_on_printer_check" CHECK(present_on_printer IN (0,1)),
	CONSTRAINT "media_configs_visible_check" CHECK(visible IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_configs_printer_id_source_media_id_unique` ON `media_configs` (`printer_id`,`source_media_id`);--> statement-breakpoint
CREATE TABLE `media_revisions` (
	`id` integer PRIMARY KEY NOT NULL,
	`media_id` integer NOT NULL,
	`content_hash` text NOT NULL,
	`names_json` text NOT NULL,
	`short_name` text,
	`english_name` text,
	`checksum` text,
	`first_observed_at` text NOT NULL,
	`last_observed_at` text NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media_configs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "media_revisions_names_json_check" CHECK(json_valid(names_json))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_revisions_media_id_content_hash_unique` ON `media_revisions` (`media_id`,`content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_revisions_media_id_id_unique` ON `media_revisions` (`media_id`,`id`);--> statement-breakpoint
CREATE TABLE `media_stock_mappings` (
	`id` integer PRIMARY KEY NOT NULL,
	`media_config_id` integer NOT NULL,
	`width_um` integer NOT NULL,
	`height_um` integer NOT NULL,
	`effective_from` text NOT NULL,
	`paper_stock_id` integer NOT NULL,
	FOREIGN KEY (`media_config_id`) REFERENCES `media_configs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`paper_stock_id`) REFERENCES `paper_stocks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "media_stock_mappings_width_um_check" CHECK(width_um > 0),
	CONSTRAINT "media_stock_mappings_height_um_check" CHECK(height_um > 0),
	CONSTRAINT "media_stock_mappings_effective_from_check" CHECK(length(effective_from)=10 AND date(effective_from) IS NOT NULL AND date(effective_from)=effective_from)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_stock_mappings_media_config_id_width_um_height_um_effective_from_unique` ON `media_stock_mappings` (`media_config_id`,`width_um`,`height_um`,`effective_from`);--> statement-breakpoint
CREATE TABLE `paper_prices` (
	`id` integer PRIMARY KEY NOT NULL,
	`paper_stock_id` integer NOT NULL,
	`effective_from` text NOT NULL,
	`currency` text NOT NULL,
	`amount_micros` integer NOT NULL,
	`quantity` integer NOT NULL,
	`quantity_unit` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`paper_stock_id`) REFERENCES `paper_stocks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "paper_prices_effective_from_check" CHECK(length(effective_from)=10 AND date(effective_from) IS NOT NULL AND date(effective_from)=effective_from),
	CONSTRAINT "paper_prices_currency_check" CHECK(length(currency)=3 AND currency NOT GLOB '*[^A-Z]*'),
	CONSTRAINT "paper_prices_amount_micros_check" CHECK(typeof(amount_micros)='integer' AND amount_micros >= 0),
	CONSTRAINT "paper_prices_quantity_check" CHECK(typeof(quantity)='integer' AND quantity > 0),
	CONSTRAINT "paper_prices_quantity_unit_check" CHECK(quantity_unit IN ('sheet','mm'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `paper_prices_paper_stock_id_currency_quantity_unit_effective_from_unique` ON `paper_prices` (`paper_stock_id`,`currency`,`quantity_unit`,`effective_from`);--> statement-breakpoint
CREATE TABLE `paper_stocks` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`brand` text,
	`product_code` text,
	`format` text NOT NULL,
	`width_um` integer,
	`height_um` integer,
	`notes` text,
	CONSTRAINT "paper_stocks_name_check" CHECK(length(trim(name)) > 0),
	CONSTRAINT "paper_stocks_format_check" CHECK(format IN ('sheet','roll')),
	CONSTRAINT "paper_stocks_width_um_check" CHECK(width_um > 0),
	CONSTRAINT "paper_stocks_height_um_check" CHECK(height_um > 0)
);
--> statement-breakpoint
CREATE TABLE `print_jobs` (
	`id` integer PRIMARY KEY NOT NULL,
	`printer_id` integer NOT NULL,
	`source_record_id` integer NOT NULL,
	`identity_hash` text NOT NULL,
	`identity_json` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`current_observation_id` integer,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`id`,`current_observation_id`) REFERENCES `job_observations`(`job_id`,`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED, -- Added by hand: Drizzle cannot declare DEFERRABLE.
	CONSTRAINT "print_jobs_source_record_id_check" CHECK(source_record_id >= 0),
	CONSTRAINT "print_jobs_identity_json_check" CHECK(json_valid(identity_json))
);
--> statement-breakpoint
CREATE INDEX `jobs_source_id` ON `print_jobs` (`printer_id`,`source_record_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `print_jobs_printer_id_source_record_id_identity_hash_unique` ON `print_jobs` (`printer_id`,`source_record_id`,`identity_hash`);--> statement-breakpoint
CREATE TABLE `printer_ink_mappings` (
	`printer_id` integer NOT NULL,
	`channel` text NOT NULL,
	`effective_from` text NOT NULL,
	`ink_product_id` integer NOT NULL,
	PRIMARY KEY(`printer_id`, `channel`, `effective_from`),
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ink_product_id`) REFERENCES `ink_products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "printer_ink_mappings_effective_from_check" CHECK(length(effective_from)=10 AND date(effective_from) IS NOT NULL AND date(effective_from)=effective_from)
);
--> statement-breakpoint
CREATE TABLE `printers` (
	`id` integer PRIMARY KEY NOT NULL,
	`mac` text NOT NULL,
	`display_name` text,
	`model` text,
	`timezone` text,
	`last_host` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`media_observed_at` text,
	CONSTRAINT "printers_mac_check" CHECK(length(mac)=12 AND mac NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `printers_mac_unique` ON `printers` (`mac`);--> statement-breakpoint
CREATE VIEW `job_details` AS SELECT j.id AS job_id, j.printer_id, j.source_record_id,
       j.first_seen_at, j.last_seen_at,
       o.job_name, o.job_owner, o.started_at_raw, o.completed_at_raw,
       o.completion_state, o.job_type, o.width_um, o.height_um, o.used_area_mm2,
       o.impressions, o.color_pages, o.monochrome_pages, o.duplex,
       m.source_media_id, r.english_name AS configured_paper_name,
       o.resolved_media_name AS paper_name_at_import,
       COALESCE(a.custom_paper_name, s.name, r.english_name, r.short_name,
                o.resolved_media_name) AS display_paper_name,
       COALESCE(a.hidden, 0) AS hidden, a.custom_paper_name,
       a.paper_stock_id AS stock_override_id, a.notes,
       a.physical_sheet_count, a.paper_cost_override_micros, a.paper_cost_currency,
       CASE WHEN EXISTS(SELECT 1 FROM print_jobs other
                        WHERE other.printer_id=j.printer_id
                          AND other.source_record_id=j.source_record_id
                          AND other.id<>j.id) THEN 1 ELSE 0 END AS record_id_collision
FROM print_jobs j
JOIN job_observations o ON o.id=j.current_observation_id
LEFT JOIN media_configs m ON m.id=o.media_config_id
LEFT JOIN media_revisions r ON r.id=m.current_revision_id
LEFT JOIN job_annotations a ON a.job_id=j.id
LEFT JOIN paper_stocks s ON s.id=a.paper_stock_id;--> statement-breakpoint
-- Marks the file as a printtally database, in the same transaction as the schema.
PRAGMA application_id = 1128353872;
