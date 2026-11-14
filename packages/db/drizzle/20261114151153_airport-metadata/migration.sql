CREATE TABLE `airports` (
	`simulator` text NOT NULL,
	`folderName` text NOT NULL,
	`sourceKey` text NOT NULL,
	`icaoCode` text,
	`iataCode` text,
	`name` text,
	`elevationMeters` real,
	`latitude` real,
	`longitude` real,
	CONSTRAINT `airports_pk` PRIMARY KEY(`simulator`, `folderName`, `sourceKey`)
);
--> statement-breakpoint
CREATE INDEX `airports_icao` ON `airports` (`icaoCode`);--> statement-breakpoint
CREATE INDEX `airports_iata` ON `airports` (`iataCode`);