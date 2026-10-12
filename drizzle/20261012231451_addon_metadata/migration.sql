CREATE TABLE `aircraft` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`package_id` integer NOT NULL,
	`source_key` text NOT NULL,
	`name` text,
	`manufacturer` text,
	`model` text,
	`icao_type_designator` text,
	CONSTRAINT `fk_aircraft_package_id_packages_id_fk` FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `airlines` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text,
	`icao_code` text,
	`iata_code` text,
	CONSTRAINT "airlines_known_identity" CHECK("name" IS NOT NULL OR "icao_code" IS NOT NULL OR "iata_code" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `airports` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`package_id` integer NOT NULL,
	`source_key` text NOT NULL,
	`name` text,
	`icao_code` text,
	`iata_code` text,
	CONSTRAINT `fk_airports_package_id_packages_id_fk` FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `liveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`package_id` integer NOT NULL,
	`source_key` text NOT NULL,
	`name` text,
	`aircraft_id` integer,
	`target_aircraft_key` text,
	`airline_id` integer,
	`registration` text,
	CONSTRAINT `fk_liveries_package_id_packages_id_fk` FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_liveries_aircraft_id_aircraft_id_fk` FOREIGN KEY (`aircraft_id`) REFERENCES `aircraft`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_liveries_airline_id_airlines_id_fk` FOREIGN KEY (`airline_id`) REFERENCES `airlines`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `packages` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`source_path` text NOT NULL UNIQUE,
	`title` text,
	`creator` text,
	`manufacturer` text,
	`version` text,
	`content_type` text,
	`minimum_game_version` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aircraft_package_source` ON `aircraft` (`package_id`,`source_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `airlines_icao` ON `airlines` (`icao_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `airlines_iata` ON `airlines` (`iata_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `airports_package_source` ON `airports` (`package_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `airports_icao` ON `airports` (`icao_code`);--> statement-breakpoint
CREATE INDEX `airports_iata` ON `airports` (`iata_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `liveries_package_source` ON `liveries` (`package_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `liveries_aircraft` ON `liveries` (`aircraft_id`);--> statement-breakpoint
CREATE INDEX `liveries_airline` ON `liveries` (`airline_id`);