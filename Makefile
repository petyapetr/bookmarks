include .env

help: 
	@echo "Available targets:"
	@echo "	push      — push schema to the database"

push:
	mkdir -p db && touch $(DB_FILE_URL)
	sqlite3 $(DB_FILE_URL) < $(DB_SCHEMA_URL)
