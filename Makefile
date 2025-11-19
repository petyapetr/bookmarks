include .env
include .env.deploy

help: 
	@echo "Available targets:"
	@echo "	push      — push schema to the database"
	@echo "	deploy    — deploying changes to the vps"

push:
	mkdir -p db && touch $(DB_FILE_URL)
	sqlite3 $(DB_FILE_URL) < $(DB_SCHEMA_URL)

deploy:
	@echo "Building tailwind..."
	pnpm exec tailwindcss -i src/input.css -o public/style.css
	@echo "Syncing to VPS..."
	rsync -azP --delete \
		--include="public/***" \
		--include="src/***" \
		--include="package.json" \
		--include=".env.example" \
		--exclude="*" \
		-e "ssh -i $(SSH_KEY_PATH)" \
		$(CURDIR)/ $(VPS_USER)@$(VPS_IP):/opt/urls/
	@echo "Installing dependencies on VPS..."
	ssh -i $(SSH_KEY_PATH) $(VPS_USER)@$(VPS_IP) "cd /opt/urls/ && pnpm install && pnpm prune --prod"
	@echo "Restarting service..."
	ssh -i $(SSH_KEY_PATH) $(VPS_USER)@$(VPS_IP) "sudo systemctl restart urls.service"
	@echo "✔️ Deployed"
