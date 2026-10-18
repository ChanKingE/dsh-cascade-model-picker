window.__ModuleLoader__.load({
	id: "dsh-cascade-model-picker",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let _deepseek_ai_cordis = require("@deepseek-ai/cordis");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/catalog.ts
		/** Loads at most one model catalog for the current Host generation. */
		var ModelCatalogDirectory = class {
			session;
			/** Current shared catalog value and load lifecycle. */
			store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({
				value: null,
				status: "idle",
				error: null
			});
			generation = 0;
			inflight;
			/** @param session - Session Remote namespace carrying the Host-generation catalog. */
			constructor(session) {
				this.session = session;
			}
			/**
			* Return the current generation's catalog, sharing its one in-flight load.
			* @returns the loaded global catalog.
			*/
			load() {
				const state = this.store.getSnapshot();
				if (state.status === "ready" && state.value !== null) return Promise.resolve(state.value);
				if (this.inflight !== void 0) return this.inflight;
				const generation = this.generation;
				this.store.update((draft) => {
					draft.status = "loading";
					draft.error = null;
				});
				const operation = this.session.modelCatalog().then((response) => {
					if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
					if (generation === this.generation) this.store.set({
						value: response.value,
						status: "ready",
						error: null
					});
					return response.value;
				}).catch((error) => {
					if (generation === this.generation) this.store.update((draft) => {
						draft.status = "error";
						draft.error = error instanceof Error ? error.message : String(error);
					});
					throw error;
				}).finally(() => {
					if (generation === this.generation && this.inflight === operation) this.inflight = void 0;
				});
				this.inflight = operation;
				return operation;
			}
			/**
			* Invalidate the loaded catalog; the next explicit menu read reloads it.
			* @param clear - whether values from the previous Host generation must be hidden.
			*/
			invalidate(clear = false) {
				this.generation += 1;
				this.inflight = void 0;
				const value = clear ? null : this.store.getSnapshot().value;
				this.store.set({
					value,
					status: "idle",
					error: null
				});
			}
			/** Invalidate and reload the catalog after a Host-side model input changes. */
			refresh() {
				this.invalidate();
				this.load().catch(() => {});
			}
			/** Clear Host-specific values and load the replacement Host generation. */
			resetGeneration() {
				this.invalidate(true);
				this.load().catch(() => {});
			}
		};
		//#endregion
		//#region src/client/directory.ts
		/** One session's shared directory controller; disposed with the session scope. */
		var ModelDirectory = class {
			sessions;
			sessionId;
			available;
			catalog;
			projected;
			/** The shared snapshot both entries render from (uSES-safe store). */
			store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({
				current: null,
				routable: null,
				groups: [],
				failures: [],
				status: "idle",
				error: null
			});
			/** Latest selection operation wins; an older response never overwrites a newer one. */
			generation = 0;
			disposed = false;
			resolved = false;
			unsubscribeCatalog;
			unsubscribeSelection;
			/**
			* @param sessions - the session wire face (captured from the plugin's root connection).
			* @param sessionId - the owning session.
			* @param available - whether this session may use Agent-bound model RPCs.
			* @param catalog - Host-generation catalog shared by every Session.
			* @param projected - durable model selection projected from Session history.
			*/
			constructor(sessions, sessionId, available, catalog, projected) {
				this.sessions = sessions;
				this.sessionId = sessionId;
				this.available = available;
				this.catalog = catalog;
				this.projected = projected;
				this.unsubscribeCatalog = catalog.store.subscribe(() => {
					this.syncInputs();
				});
				this.unsubscribeSelection = projected.subscribe(() => {
					this.syncInputs();
				});
				this.syncInputs();
			}
			/**
			* Ensure the Host generation's shared advisory catalog is loaded.
			* @returns the fresh directory value.
			*/
			async load() {
				this.assertAvailable();
				await this.catalog.load();
				this.syncInputs();
				return this.store.getSnapshot();
			}
			/**
			* Select the complete provider/model/reasoning selection. The durable
			* projection frame updates the shared current; failures surface on the store
			* and throw so each entry's own retry surface engages.
			* @param selection - provider, provider-owned model id, and optional adapter-owned effort.
			*/
			async select(selection) {
				this.assertAvailable();
				const generation = ++this.generation;
				this.store.update((s) => {
					s.status = "selecting";
					s.error = null;
				});
				const result = await this.sessions.selectModel({
					sessionId: this.sessionId,
					provider: selection.provider,
					model: selection.model,
					...selection.reasoningEffort === void 0 ? {} : { reasoningEffort: selection.reasoningEffort }
				});
				if (this.disposed || generation !== this.generation) {
					if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
					return;
				}
				if (!result.ok) {
					this.store.update((s) => {
						s.status = "error";
						s.error = `${result.error.code}: ${result.error.message}`;
					});
					throw new Error(`session.selectModel failed: ${result.error.code}: ${result.error.message}`);
				}
				this.store.update((s) => {
					s.status = "ready";
					s.error = null;
				});
				this.syncInputs();
			}
			/**
			* Invalidate an in-flight selection response from the previous Host generation.
			*/
			resetConnected() {
				if (this.disposed) return;
				++this.generation;
				this.store.update((state) => {
					if (state.status === "selecting") state.status = "idle";
					state.error = null;
				});
				this.syncInputs();
			}
			/** Scope teardown: late settlements lose write access to the store. */
			dispose() {
				this.disposed = true;
				this.unsubscribeSelection();
				this.unsubscribeCatalog();
			}
			assertAvailable() {
				if (!this.available()) throw new Error("model selection is unavailable for addressed subagent sessions");
			}
			syncInputs() {
				if (this.disposed) return;
				const catalog = this.catalog.store.getSnapshot();
				const projected = modelSelectionProjection(this.projected.getSnapshot());
				if (catalog.status !== "ready" || catalog.value === null || projected === void 0) {
					if (this.resolved) {
						if (catalog.status === "error") this.store.update((state) => {
							state.status = "error";
							state.error = catalog.error;
						});
						return;
					}
					this.store.set({
						current: null,
						routable: null,
						groups: [],
						failures: [],
						status: catalog.status === "error" ? "error" : "loading",
						error: catalog.error
					});
					return;
				}
				const current = projected.next ?? catalog.value.default;
				this.resolved = true;
				this.store.set({
					current,
					routable: catalog.value.routableProviders.includes(current.provider),
					groups: catalog.value.groups,
					failures: catalog.value.failures,
					status: this.store.getSnapshot().status === "selecting" ? "selecting" : "ready",
					error: null
				});
			}
		};
		function modelSelectionProjection(value) {
			return value === void 0 ? void 0 : value;
		}
		//#endregion
		//#region src/client/service.ts
		/**
		* ModelDirectoryResolver (`ctx.modelDirectories`): the root owner of per-session
		* {@link ModelDirectory} instances. Both selection entries (the /model popup
		* and the composer model seat) resolve their session's directory through
		* this service, which is what makes the dual entry one shared state.
		*
		* Per-session storage follows the client service pattern (InputTriggerService /
		* CommandUiRuntime): a lazy service-internal map whose entry is deleted by the
		* owning scope's disposer. The host `dsh-scope` ScopedLayers registry does
		* does not belong here: it derives scope from the host carrier mechanism
		* (object-keyed), while client scopes tag contexts with branded SessionId
		* strings, and it models global+shadow named registries — this is a
		* per-session singleton with no global layer to merge.
		*/
		/** The `ctx.modelDirectories` session model-selection service. */
		var ModelDirectoryResolver = class extends _deepseek_ai_cordis.Service {
			static inject = [
				"sessions",
				"remote",
				"remote.session"
			];
			live = { directories: /* @__PURE__ */ new Map() };
			catalog;
			/** Localized composer-block copy; this plugin owns the string it raises. */
			blockReason;
			/**
			* @param ctx - owning root context (the service registers itself as `models`).
			* @param config - the bound translator for this plugin's own dictionary.
			*/
			constructor(ctx, config) {
				super(ctx, "modelDirectories");
				this.blockReason = config.blockReason;
				this.catalog = new ModelCatalogDirectory(ctx.remote.session);
				this.catalog.load().catch(() => {});
				ctx.on("connection/reset", () => {
					this.catalog.resetGeneration();
					for (const directory of this.live.directories.values()) directory.resetConnected();
				});
				ctx.remote.$on("llm/adapters-updated", () => {
					this.catalog.refresh();
				});
				ctx.remote.$on("settings/document-updated", () => {
					this.catalog.refresh();
				});
				ctx.remote.$on("credentials/reference-updated", () => {
					this.catalog.refresh();
				});
			}
			/**
			* Resolve the per-session shared directory (lazy; the scope disposer
			* removes and disposes it). Unknown sessions fail loud.
			* @param sessionId - the owning session.
			* @returns the resident directory both entries share.
			*/
			directoryFor(sessionId) {
				const { live } = this;
				const existing = live.directories.get(sessionId);
				if (existing !== void 0) return existing;
				const sessions = this.ctx.sessions;
				const actx = sessions.scope(sessionId);
				if (actx === void 0) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no scope`);
				const binding = sessions.binding(sessionId);
				if (binding === void 0) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no binding`);
				const directory = new ModelDirectory(this.ctx.remote.session, sessionId, () => sessions.subagentAddress(sessionId) === void 0, this.catalog, binding.session.projections.faceOf("modelSelection"));
				live.directories.set(sessionId, directory);
				const conversation = this.ctx.get("conversation");
				if (conversation !== void 0) {
					const publish = () => {
						conversation.blocks.set(sessionId, directory.store.getSnapshot().routable === false ? { reason: this.blockReason() } : void 0);
					};
					publish();
					actx.effect(() => {
						const stop = directory.store.subscribe(publish);
						return () => {
							stop();
							conversation.blocks.set(sessionId, void 0);
						};
					}, "ui-model-selection: composer block");
				}
				actx.effect(() => () => {
					directory.dispose();
					live.directories.delete(sessionId);
				}, "ui-model-selection: session directory");
				return directory;
			}
		};
		//#endregion
		//#region ../deepseek-harness/node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
		function r(e) {
			var t, f, n = "";
			if ("string" == typeof e || "number" == typeof e) n += e;
			else if ("object" == typeof e) if (Array.isArray(e)) {
				var o = e.length;
				for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
			} else for (f in e) e[f] && (n && (n += " "), n += f);
			return n;
		}
		function clsx() {
			for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
			return n;
		}
		//#endregion
		//#region \0dsh-css:D:\deepseek\dsh-cascade-model-picker\src\client\ModelSelect.module.css.mjs
		const css = ".LkA5aq_root{min-width:0;position:relative}.LkA5aq_trigger{min-width:0;max-width:min(360px,45cqw);height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:24px;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:500;line-height:20px;display:flex}.LkA5aq_trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.LkA5aq_trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}.LkA5aq_trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}.LkA5aq_triggerProvider{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px;line-height:20px}.LkA5aq_triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-family:var(--ds-font-family-code);font-size:12px;overflow:hidden}.LkA5aq_triggerEffort{border-left:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-caption);flex:none;padding-left:6px;font-size:11px}.LkA5aq_chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s}.LkA5aq_chevronOpen{transform:rotate(180deg)}.LkA5aq_menu{z-index:20;border:1px solid var(--dsw-alias-border-l2);background-color:var(--dsw-alias-bg-layer-2);background-image:linear-gradient(var(--dsw-specific-menu), var(--dsw-specific-menu));width:min(580px,100vw - 32px);max-height:min(470px,100vh - 96px);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border-radius:12px;flex-direction:column;display:flex;position:absolute;bottom:calc(100% + 8px);right:0;overflow:hidden}.LkA5aq_head{border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;justify-content:space-between;align-items:center;gap:8px;height:44px;padding:0 10px 0 12px;display:flex}.LkA5aq_headTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:13px;font-weight:600;line-height:20px}.LkA5aq_headHint{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:11px;line-height:16px}.LkA5aq_status,.LkA5aq_empty{color:var(--dsw-alias-label-tertiary);flex:none;padding:10px 12px;font-size:13px;line-height:20px}.LkA5aq_error,.LkA5aq_warning{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);border-radius:8px;flex:none;justify-content:space-between;align-items:flex-start;gap:8px;margin:4px 8px 0;padding:7px 8px;font-size:12px;line-height:18px;display:flex}.LkA5aq_warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}.LkA5aq_retry{color:inherit;font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0;font-weight:600}.LkA5aq_search{border-bottom:1px solid var(--dsw-alias-border-l1);height:40px;color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;gap:8px;padding:0 12px;display:flex}.LkA5aq_searchIcon{flex:none}.LkA5aq_searchInput{min-width:0;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);background:0 0;border:none;outline:none;flex:1;font-size:13px;line-height:20px}.LkA5aq_searchInput::placeholder{color:var(--dsw-alias-label-tertiary)}.LkA5aq_searchClear{width:20px;height:20px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:4px;outline:none;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.LkA5aq_searchClear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.LkA5aq_searchClear:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}.LkA5aq_path{border-bottom:1px solid var(--dsw-alias-border-l1);min-height:34px;color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;gap:6px;padding:0 12px;font-size:12px;line-height:18px;display:flex}.LkA5aq_pathNode{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.LkA5aq_pathNodeCurrent{color:var(--dsw-alias-state-business-primary);font-family:var(--ds-font-family-code);font-weight:600}.LkA5aq_pathSep{color:var(--dsw-alias-label-tertiary);flex:none}.LkA5aq_pathStretch{flex:auto}.LkA5aq_effortStrip{border:1px solid var(--dsw-alias-border-l2);height:22px;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family);cursor:pointer;background:0 0;border-radius:24px;outline:none;flex:none;align-items:center;gap:2px;padding:0 6px 0 8px;font-size:11px;line-height:16px;display:inline-flex}.LkA5aq_effortStrip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.LkA5aq_effortStrip:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}.LkA5aq_effortStripChevron{color:var(--dsw-alias-label-tertiary);flex:none}.LkA5aq_columns{flex:auto;grid-template-columns:240px minmax(0,1fr);min-height:0;display:grid}.LkA5aq_column{min-height:0;margin:0;padding:6px 0;list-style:none;overflow-y:auto}.LkA5aq_columns>.LkA5aq_column+.LkA5aq_column,.LkA5aq_columns>*+.LkA5aq_column{border-left:1px solid var(--dsw-alias-border-l1)}.LkA5aq_row{width:100%;min-height:34px;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family);text-align:left;cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:8px;padding:0 10px 0 12px;font-size:13px;line-height:20px;display:flex}.LkA5aq_row:hover:not(:disabled),.LkA5aq_row:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.LkA5aq_row:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}.LkA5aq_rowActive,.LkA5aq_rowActive:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}.LkA5aq_rowSelected,.LkA5aq_rowSelected:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);color:var(--dsw-alias-label-primary)}.LkA5aq_providerMark{background:var(--dsw-alias-interactive-bg-hover);width:20px;height:20px;color:var(--dsw-alias-label-secondary);letter-spacing:.02em;border-radius:24px;flex:none;justify-content:center;align-items:center;font-size:10px;font-weight:600;line-height:1;display:inline-flex}.LkA5aq_rowActive .LkA5aq_providerMark{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);color:var(--dsw-alias-state-business-primary)}.LkA5aq_providerName{text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;overflow:hidden}.LkA5aq_providerCount{background:var(--dsw-alias-interactive-bg-hover);min-width:18px;height:18px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;border-radius:24px;flex:none;justify-content:center;align-items:center;padding:0 5px;font-size:11px;line-height:1;display:inline-flex}.LkA5aq_providerArrow{color:var(--dsw-alias-label-tertiary);flex:none}.LkA5aq_modelName{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-family:var(--ds-font-family-code);letter-spacing:-.01em;flex:1;font-size:12.5px;overflow:hidden}.LkA5aq_modelNameSelected{color:var(--dsw-alias-state-business-primary);font-weight:600}.LkA5aq_rowCheck{color:var(--dsw-alias-state-business-primary);flex:0 0 14px;place-items:center;display:grid}.LkA5aq_resultProvider{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);flex:0 auto;font-size:12px;overflow:hidden}.LkA5aq_highlight{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);color:var(--dsw-alias-state-business-primary);border-radius:2px;padding:0 1px}.LkA5aq_emptyState{text-align:center;flex-direction:column;justify-content:center;align-items:center;gap:8px;padding:24px 16px;display:flex}.LkA5aq_emptyStateIcon{background:var(--dsw-alias-interactive-bg-hover);width:32px;height:32px;color:var(--dsw-alias-label-tertiary);border-radius:24px;justify-content:center;align-items:center;display:inline-flex}.LkA5aq_emptyStateTitle{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px;line-height:20px}.LkA5aq_emptyStateHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}.LkA5aq_foot{border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);flex-wrap:wrap;flex:none;align-items:center;gap:12px;padding:8px 12px;display:flex}.LkA5aq_keyHint{color:var(--dsw-alias-label-tertiary);align-items:center;gap:4px;font-size:11px;line-height:16px;display:inline-flex}.LkA5aq_kbd{border:1px solid var(--dsw-alias-border-l2);background-color:var(--dsw-alias-bg-layer-2);background-image:linear-gradient(var(--dsw-specific-menu), var(--dsw-specific-menu));min-width:18px;height:18px;color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);border-radius:4px;justify-content:center;align-items:center;padding:0 4px;font-size:10px;line-height:1;display:inline-flex}";
		const tagId = "dsh-cascade-model-picker/ModelSelect.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-cascade-model-picker";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var ModelSelect_module_css_default = {
			"chevron": "LkA5aq_chevron",
			"chevronOpen": "LkA5aq_chevronOpen",
			"column": "LkA5aq_column",
			"columns": "LkA5aq_columns",
			"effortStrip": "LkA5aq_effortStrip",
			"effortStripChevron": "LkA5aq_effortStripChevron",
			"empty": "LkA5aq_empty",
			"emptyState": "LkA5aq_emptyState",
			"emptyStateHint": "LkA5aq_emptyStateHint",
			"emptyStateIcon": "LkA5aq_emptyStateIcon",
			"emptyStateTitle": "LkA5aq_emptyStateTitle",
			"error": "LkA5aq_error",
			"foot": "LkA5aq_foot",
			"head": "LkA5aq_head",
			"headHint": "LkA5aq_headHint",
			"headTitle": "LkA5aq_headTitle",
			"highlight": "LkA5aq_highlight",
			"kbd": "LkA5aq_kbd",
			"keyHint": "LkA5aq_keyHint",
			"menu": "LkA5aq_menu",
			"modelName": "LkA5aq_modelName",
			"modelNameSelected": "LkA5aq_modelNameSelected",
			"path": "LkA5aq_path",
			"pathNode": "LkA5aq_pathNode",
			"pathNodeCurrent": "LkA5aq_pathNodeCurrent",
			"pathSep": "LkA5aq_pathSep",
			"pathStretch": "LkA5aq_pathStretch",
			"providerArrow": "LkA5aq_providerArrow",
			"providerCount": "LkA5aq_providerCount",
			"providerMark": "LkA5aq_providerMark",
			"providerName": "LkA5aq_providerName",
			"resultProvider": "LkA5aq_resultProvider",
			"retry": "LkA5aq_retry",
			"root": "LkA5aq_root",
			"row": "LkA5aq_row",
			"rowActive": "LkA5aq_rowActive",
			"rowCheck": "LkA5aq_rowCheck",
			"rowSelected": "LkA5aq_rowSelected",
			"search": "LkA5aq_search",
			"searchClear": "LkA5aq_searchClear",
			"searchIcon": "LkA5aq_searchIcon",
			"searchInput": "LkA5aq_searchInput",
			"status": "LkA5aq_status",
			"trigger": "LkA5aq_trigger",
			"triggerEffort": "LkA5aq_triggerEffort",
			"triggerLabel": "LkA5aq_triggerLabel",
			"triggerProvider": "LkA5aq_triggerProvider",
			"warning": "LkA5aq_warning"
		};
		//#endregion
		//#region src/client/ModelSelect.tsx
		/**
		* ModelSelect: the composer's named model seat (`conversation.input.model`),
		* rendered as the cascade picker of the desktop spec 「模型选择器 · 级联选择」.
		* The open panel is a dialog over one per-session ModelDirectory: a search
		* field, a breadcrumb of the active route with the reasoning-effort strip,
		* and two columns — providers, then the active provider's models. Typing
		* flattens the columns into `provider › model` result rows with the matched
		* fragments marked; picking no provider shows the right-column empty state.
		* The effort strip drills into the adapter-advertised effort list of the
		* current model. Data and submission ride the SAME per-session
		* ModelDirectory as the /model popup; exact-model reasoning metadata and the
		* selected effort come from the Host rather than a client-owned vocabulary.
		* A rejected selection announces through the shared transient Toast anchored
		* to the composer card; the in-panel strip with Retry remains the
		* catalog-load surface. Rows are real focusable options: arrow keys move DOM
		* focus within and across columns, Enter activates the focused row, Escape
		* backs out of search, then the effort drill-down, then closes.
		*/
		/**
		* Split `text` on every case-insensitive occurrence of `query` into marked
		* and plain segments; a blank query yields the whole text as one plain
		* segment.
		* @param text - the provider or model display name.
		* @param query - the trimmed search text.
		* @returns segments in document order; `matched` marks highlighted segments.
		*/
		function highlightSegments(text, query) {
			if (query === "") return [{
				text,
				matched: false
			}];
			const lowerText = text.toLowerCase();
			const lowerQuery = query.toLowerCase();
			const segments = [];
			let cursor = 0;
			while (cursor < text.length) {
				const at = lowerText.indexOf(lowerQuery, cursor);
				if (at === -1) {
					segments.push({
						text: text.slice(cursor),
						matched: false
					});
					break;
				}
				if (at > cursor) segments.push({
					text: text.slice(cursor, at),
					matched: false
				});
				segments.push({
					text: text.slice(at, at + query.length),
					matched: true
				});
				cursor = at + query.length;
			}
			return segments;
		}
		/**
		* Render the composer model seat.
		* @param props - owner share (locked) + injected face (shared directory
		* store/verbs) + the standard locale seat.
		* @returns the trigger and, while open, the cascade picker dialog.
		*/
		function ModelSelect({ locked, available, directory, load, select, t }) {
			const state = (0, react.useSyncExternalStore)((fn) => directory.subscribe(fn), () => directory.getSnapshot());
			const [open, setOpen] = (0, react.useState)(false);
			const [pane, setPane] = (0, react.useState)("browse");
			const [query, setQuery] = (0, react.useState)("");
			const [activeProviderId, setActiveProviderId] = (0, react.useState)(null);
			const lastActionRef = (0, react.useRef)("load");
			const [toast, setToast] = (0, react.useState)(null);
			const toastSeq = (0, react.useRef)(0);
			const rootRef = (0, react.useRef)(null);
			const triggerRef = (0, react.useRef)(null);
			const searchInputRef = (0, react.useRef)(null);
			const effortStripRef = (0, react.useRef)(null);
			const providerRefs = (0, react.useRef)([]);
			const modelRefs = (0, react.useRef)([]);
			const searchRefs = (0, react.useRef)([]);
			const effortRefs = (0, react.useRef)([]);
			const id = (0, react.useId)();
			const currentChoice = (0, react.useMemo)(() => {
				if (state.current === null) return void 0;
				for (const group of state.groups) {
					if (group.id !== state.current.provider) continue;
					for (const model of group.models) {
						if (model.id !== state.current.model) continue;
						return {
							group,
							model
						};
					}
				}
			}, [state.current, state.groups]);
			const reasoning = currentChoice?.model.reasoning;
			const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort;
			const effortLabel = reasoning === void 0 ? void 0 : effectiveEffort === void 0 ? t("effort.providerDefault") : reasoning.efforts.find((level) => level.id === effectiveEffort)?.name ?? effectiveEffort;
			const effortChoices = (0, react.useMemo)(() => reasoning === void 0 ? [] : [...reasoning.defaultEffort === void 0 ? [{
				key: "provider-default",
				effort: void 0,
				label: t("effort.providerDefault")
			}] : [], ...reasoning.efforts.map((effort) => ({
				key: `effort:${effort.id}`,
				effort: effort.id,
				label: effort.name
			}))], [reasoning, t]);
			const searchQuery = query.trim();
			const searchHits = (0, react.useMemo)(() => {
				const needle = searchQuery.toLowerCase();
				if (needle === "") return [];
				const hits = [];
				for (const group of state.groups) {
					const providerHit = group.name.toLowerCase().includes(needle);
					for (const model of group.models) if (providerHit || model.name.toLowerCase().includes(needle)) hits.push({
						group,
						model
					});
				}
				return hits;
			}, [state.groups, searchQuery]);
			const activeGroup = activeProviderId === null ? void 0 : state.groups.find((group) => group.id === activeProviderId);
			const busy = state.status === "selecting";
			const reload = () => {
				lastActionRef.current = "load";
				load();
			};
			(0, react.useEffect)(() => {
				if (!open) return;
				const closeOutside = (event) => {
					if (!rootRef.current?.contains(event.target)) setOpen(false);
				};
				document.addEventListener("mousedown", closeOutside);
				return () => {
					document.removeEventListener("mousedown", closeOutside);
				};
			}, [open]);
			(0, react.useEffect)(() => {
				if (open && pane === "browse") searchInputRef.current?.focus();
			}, [open]);
			if (!available) return null;
			const show = () => {
				const currentAdvertised = state.groups.some((group) => group.id === state.current?.provider);
				setPane("browse");
				setQuery("");
				setActiveProviderId(state.current?.provider !== void 0 && currentAdvertised ? state.current.provider : state.groups[0]?.id ?? null);
				setOpen(true);
				reload();
			};
			const close = (restoreFocus = false) => {
				setOpen(false);
				setPane("browse");
				if (restoreFocus) queueMicrotask(() => {
					triggerRef.current?.focus();
				});
			};
			const collectRefs = (refs) => refs.current?.filter((item) => item !== null) ?? [];
			const moveFocus = (items, offset) => {
				if (items.length === 0) return;
				const active = items.findIndex((item) => item === document.activeElement);
				items[(Math.max(active, 0) + offset + items.length) % items.length]?.focus();
			};
			/** Column arrows land on a column's first row (selected row keeps its order). */
			const focusFirstRow = (refs) => {
				const items = collectRefs(refs);
				if (items.length > 0) items[0]?.focus();
			};
			const activeRows = () => {
				if (pane === "effort") return collectRefs(effortRefs);
				if (searchQuery !== "") return collectRefs(searchRefs);
				const focusedIn = (refs) => collectRefs(refs).some((item) => item === document.activeElement);
				if (focusedIn(modelRefs)) return collectRefs(modelRefs);
				return collectRefs(providerRefs);
			};
			const onPanelKeyDown = (event) => {
				if (event.nativeEvent.isComposing) return;
				if (event.key === "Escape") {
					if (!open) return;
					event.preventDefault();
					if (pane === "browse" && searchQuery !== "") {
						setQuery("");
						searchInputRef.current?.focus();
						return;
					}
					if (pane === "effort") {
						setPane("browse");
						queueMicrotask(() => {
							effortStripRef.current?.focus();
						});
						return;
					}
					close(true);
					return;
				}
				if (!open || event.altKey || event.ctrlKey || event.metaKey) return;
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					const items = activeRows();
					if (items.length === 0) return;
					event.preventDefault();
					moveFocus(items, event.key === "ArrowDown" ? 1 : -1);
					return;
				}
				if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
					if (event.target === searchInputRef.current) return;
					if (pane !== "browse" || searchQuery !== "") return;
					event.preventDefault();
					if (event.key === "ArrowLeft") focusFirstRow(providerRefs);
					else if (activeGroup !== void 0) focusFirstRow(modelRefs);
				}
			};
			const onBlur = (event) => {
				if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return;
				close();
			};
			/**
			* The Host answers a selection either with a plain boolean or — since
			* 0.2.0-rc.2 — with a Result: `{ ok: true }`, `{ ok: false, error }`, or
			* `undefined` while the seat is unavailable. Both shapes are accepted so a
			* rejection always reaches the shared Toast.
			*/
			const settleSelection = (result) => {
				if (result === void 0) return;
				if (typeof result === "boolean" ? result : result.ok === true) {
					if (rootRef.current !== null) close(true);
					return;
				}
				const failure = typeof result === "boolean" ? null : result.error ?? null;
				const message = failure === null ? directory.getSnapshot().error : `${failure.code}: ${failure.message}`;
				if (message !== null) {
					toastSeq.current += 1;
					setToast({
						seq: toastSeq.current,
						text: t("error.action", { message })
					});
				}
			};
			const choose = (selection) => {
				lastActionRef.current = "select";
				close(true);
				select(selection).then(settleSelection);
			};
			const chooseEffort = (effort) => {
				if (state.current === null) return;
				const selection = {
					provider: state.current.provider,
					model: state.current.model,
					...effort === void 0 ? {} : { reasoningEffort: effort }
				};
				lastActionRef.current = "select";
				close(true);
				select(selection).then(settleSelection);
			};
			const waiting = state.current === null && state.status === "loading";
			const modelLabel = waiting ? t("trigger.loading") : currentChoice?.model.name ?? (state.current === null ? t("trigger.fallback") : `${state.current.provider}/${state.current.model}`);
			const triggerLabel = effortLabel === void 0 ? modelLabel : `${modelLabel} · ${effortLabel}`;
			const triggerAria = waiting ? t("trigger.loading") : state.current === null ? t("trigger.selectAria") : effortLabel === void 0 ? t("trigger.aria", { model: modelLabel }) : t("trigger.ariaEffort", {
				model: modelLabel,
				effort: effortLabel
			});
			providerRefs.current = [];
			modelRefs.current = [];
			searchRefs.current = [];
			effortRefs.current = [];
			let providerIndex = 0;
			let modelIndex = 0;
			let searchIndex = 0;
			let effortIndex = 0;
			const providerRef = () => {
				const at = providerIndex++;
				return (node) => {
					providerRefs.current[at] = node;
				};
			};
			const modelRef = () => {
				const at = modelIndex++;
				return (node) => {
					modelRefs.current[at] = node;
				};
			};
			const searchRef = () => {
				const at = searchIndex++;
				return (node) => {
					searchRefs.current[at] = node;
				};
			};
			const effortRef = () => {
				const at = effortIndex++;
				return (node) => {
					effortRefs.current[at] = node;
				};
			};
			/** Derived two-letter provider badge (spec .cascade-mark): initials of the display name. */
			const providerMark = (name) => {
				const words = name.split(/\s+/).filter(Boolean);
				if (words.length >= 2) return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
				return name.slice(0, 2).toUpperCase();
			};
			const providerRow = (group) => {
				const active = group.id === activeProviderId;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					ref: providerRef(),
					type: "button",
					role: "option",
					"aria-selected": active,
					className: clsx(ModelSelect_module_css_default.row, active && ModelSelect_module_css_default.rowActive),
					title: group.name,
					disabled: busy,
					onClick: () => {
						setActiveProviderId(group.id);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ModelSelect_module_css_default.providerMark,
							"aria-hidden": "true",
							children: providerMark(group.name)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ModelSelect_module_css_default.providerName,
							children: group.name
						}),
						group.models.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ModelSelect_module_css_default.providerCount,
							children: group.models.length
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { className: ModelSelect_module_css_default.providerArrow })
					]
				}, group.id);
			};
			const modelRow = (group, model) => {
				const selected = state.current?.provider === group.id && state.current.model === model.id;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					ref: modelRef(),
					type: "button",
					role: "option",
					"aria-selected": selected,
					className: clsx(ModelSelect_module_css_default.row, selected && ModelSelect_module_css_default.rowSelected),
					title: model.name,
					disabled: busy,
					onClick: () => {
						choose({
							provider: group.id,
							model: model.id
						});
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: clsx(ModelSelect_module_css_default.modelName, selected && ModelSelect_module_css_default.modelNameSelected),
						children: model.name
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ModelSelect_module_css_default.rowCheck,
						children: selected ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, {}) : null
					})]
				}, model.id);
			};
			const searchRow = (hit) => {
				const selected = state.current?.provider === hit.group.id && state.current.model === hit.model.id;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					ref: searchRef(),
					type: "button",
					role: "option",
					"aria-selected": selected,
					className: clsx(ModelSelect_module_css_default.row, selected && ModelSelect_module_css_default.rowSelected),
					title: `${hit.group.name} › ${hit.model.name}`,
					disabled: busy,
					onClick: () => {
						choose({
							provider: hit.group.id,
							model: hit.model.id
						});
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ModelSelect_module_css_default.resultProvider,
							children: highlightSegments(hit.group.name, searchQuery).map((segment, at) => segment.matched ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("mark", {
								className: ModelSelect_module_css_default.highlight,
								children: segment.text
							}, at) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: segment.text }, at))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { className: ModelSelect_module_css_default.providerArrow }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: clsx(ModelSelect_module_css_default.modelName, selected && ModelSelect_module_css_default.modelNameSelected),
							children: highlightSegments(hit.model.name, searchQuery).map((segment, at) => segment.matched ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("mark", {
								className: ModelSelect_module_css_default.highlight,
								children: segment.text
							}, at) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: segment.text }, at))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ModelSelect_module_css_default.rowCheck,
							children: selected ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, {}) : null
						})
					]
				}, `${hit.group.id}/${hit.model.id}`);
			};
			const strips = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				state.status === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: ModelSelect_module_css_default.status,
					children: t("status.loading")
				}),
				state.error !== null && lastActionRef.current === "load" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ModelSelect_module_css_default.error,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("error.action", { message: state.error }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ModelSelect_module_css_default.retry,
						onClick: reload,
						children: t("action.reload")
					})]
				}),
				state.failures.map((failure) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ModelSelect_module_css_default.warning,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("warning.groupLoad", {
						name: failure.name,
						message: failure.message
					}) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ModelSelect_module_css_default.retry,
						onClick: reload,
						children: t("retry")
					})]
				}, failure.id))
			] });
			const breadcrumb = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("nav", {
				className: ModelSelect_module_css_default.path,
				"aria-label": t("path.aria"),
				children: [
					searchQuery === "" && activeGroup !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ModelSelect_module_css_default.pathNode,
						children: activeGroup.name
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { className: ModelSelect_module_css_default.pathSep })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: clsx(ModelSelect_module_css_default.pathNode, ModelSelect_module_css_default.pathNodeCurrent),
						children: searchQuery !== "" ? t("path.search", { query: searchQuery }) : activeGroup === void 0 ? t("path.select") : state.current?.provider === activeGroup.id ? modelLabel : activeGroup.name
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: ModelSelect_module_css_default.pathStretch }),
					searchQuery === "" && effortLabel !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						ref: effortStripRef,
						type: "button",
						className: ModelSelect_module_css_default.effortStrip,
						"aria-label": t("effort.stripAria", { effort: effortLabel }),
						onClick: () => {
							setPane("effort");
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: effortLabel }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { className: ModelSelect_module_css_default.effortStripChevron })]
					})
				]
			});
			const modelColumn = activeGroup === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ModelSelect_module_css_default.emptyState,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ModelSelect_module_css_default.emptyStateIcon,
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, {})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: ModelSelect_module_css_default.emptyStateTitle,
						children: t("model.emptyTitle")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: ModelSelect_module_css_default.emptyStateHint,
						children: t("model.emptyHint")
					})
				]
			}) : activeGroup.models.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ModelSelect_module_css_default.empty,
				children: t("empty.models")
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ModelSelect_module_css_default.column,
				role: "listbox",
				"aria-label": t("model.aria"),
				children: activeGroup.models.map((model) => modelRow(activeGroup, model))
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: ModelSelect_module_css_default.root,
				onKeyDown: onPanelKeyDown,
				onBlur,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						ref: triggerRef,
						type: "button",
						className: ModelSelect_module_css_default.trigger,
						"aria-label": triggerAria,
						"aria-haspopup": "dialog",
						"aria-expanded": open,
						"aria-controls": open ? `${id}-menu` : void 0,
						title: triggerLabel,
						disabled: locked,
						onClick: () => {
							if (open) close();
							else show();
						},
						children: [
							currentChoice !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ModelSelect_module_css_default.triggerProvider,
								children: currentChoice.group.name
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ModelSelect_module_css_default.triggerLabel,
								children: modelLabel
							}),
							effortLabel !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ModelSelect_module_css_default.triggerEffort,
								children: effortLabel
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { className: clsx(ModelSelect_module_css_default.chevron, open && ModelSelect_module_css_default.chevronOpen) })
						]
					}),
					open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						id: `${id}-menu`,
						className: ModelSelect_module_css_default.menu,
						role: "dialog",
						"aria-label": t("menu.aria"),
						"aria-busy": state.status === "loading" || busy,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
								className: ModelSelect_module_css_default.head,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
									className: ModelSelect_module_css_default.headTitle,
									children: t("trigger.fallback")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ModelSelect_module_css_default.headHint,
									children: pane === "effort" ? null : searchQuery !== "" ? t("search.count", { count: searchHits.length }) : t("head.summary", {
										providers: state.groups.length,
										models: state.groups.reduce((total, group) => total + group.models.length, 0)
									})
								})]
							}),
							strips,
							pane === "effort" ? effortChoices.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: ModelSelect_module_css_default.empty,
								children: t("empty.efforts")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: ModelSelect_module_css_default.column,
								role: "listbox",
								"aria-label": t("menu.effort"),
								children: effortChoices.map((level) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									ref: effortRef(),
									type: "button",
									role: "option",
									"aria-selected": effectiveEffort === level.effort,
									className: clsx(ModelSelect_module_css_default.row, effectiveEffort === level.effort && ModelSelect_module_css_default.rowSelected),
									disabled: busy,
									onClick: () => {
										chooseEffort(level.effort);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: clsx(ModelSelect_module_css_default.modelName, effectiveEffort === level.effort && ModelSelect_module_css_default.modelNameSelected),
										children: level.label
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ModelSelect_module_css_default.rowCheck,
										children: effectiveEffort === level.effort ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, {}) : null
									})]
								}, level.key))
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ModelSelect_module_css_default.search,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutlineRegular, { className: ModelSelect_module_css_default.searchIcon }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											ref: searchInputRef,
											type: "text",
											className: ModelSelect_module_css_default.searchInput,
											"aria-label": t("search.aria"),
											placeholder: t("search.placeholder"),
											value: query,
											onChange: (event) => {
												setQuery(event.target.value);
											},
											onKeyDown: (event) => {
												if (event.key === "Enter" && !event.nativeEvent.isComposing) {
													const first = searchHits[0];
													if (first !== void 0) {
														event.preventDefault();
														choose({
															provider: first.group.id,
															model: first.model.id
														});
													}
												}
											}
										}),
										query !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: ModelSelect_module_css_default.searchClear,
											"aria-label": t("search.clear"),
											onClick: () => {
												setQuery("");
												searchInputRef.current?.focus();
											},
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutlineRegular, { size: 12 })
										})
									]
								}),
								breadcrumb,
								searchQuery !== "" ? searchHits.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: ModelSelect_module_css_default.empty,
									children: t("search.empty")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: ModelSelect_module_css_default.column,
									role: "listbox",
									"aria-label": t("search.resultsAria"),
									children: searchHits.map(searchRow)
								}) : state.groups.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: ModelSelect_module_css_default.empty,
									children: t("empty.models")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ModelSelect_module_css_default.columns,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: ModelSelect_module_css_default.column,
										role: "listbox",
										"aria-label": t("provider.aria"),
										children: state.groups.map(providerRow)
									}), modelColumn]
								})
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
								className: ModelSelect_module_css_default.foot,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: ModelSelect_module_css_default.keyHint,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("kbd", {
												className: ModelSelect_module_css_default.kbd,
												children: "↑"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("kbd", {
												className: ModelSelect_module_css_default.kbd,
												children: "↓"
											}),
											t("foot.move")
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: ModelSelect_module_css_default.keyHint,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("kbd", {
												className: ModelSelect_module_css_default.kbd,
												children: "←"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("kbd", {
												className: ModelSelect_module_css_default.kbd,
												children: "→"
											}),
											t("foot.column")
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: ModelSelect_module_css_default.keyHint,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("kbd", {
											className: ModelSelect_module_css_default.kbd,
											children: "↵"
										}), t("foot.select")]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: ModelSelect_module_css_default.keyHint,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("kbd", {
											className: ModelSelect_module_css_default.kbd,
											children: t("foot.closeKey")
										}), t("foot.close")]
									})
								]
							})
						]
					}),
					toast !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
						text: toast.text,
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {}),
						anchor: rootRef.current?.closest("[data-composer-card]") ?? null,
						onDone: () => {
							setToast(null);
						}
					}, toast.seq)
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* `model` namespace dictionaries.
		*
		* `trigger.selectAria` intentionally matches `trigger.fallback` but remains a
		* separate key: the visible fallback label and the accessible name of
		* an unset trigger are free to diverge per locale, and folding it into
		* `trigger.aria` would announce the degenerate "Select model, current Select
		* model".
		*
		* The cascade keys follow the desktop spec 「模型选择器 · 级联选择」: search
		* field, provider/model breadcrumb with the effort strip, two columns, and
		* the flattened search-result list.
		*/
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"command.label": "模型",
			"command.description": "选择本会话使用的模型",
			"option.loadError": "目录加载失败：{message}",
			"trigger.fallback": "选择模型",
			"trigger.loading": "正在加载模型…",
			"trigger.selectAria": "选择模型",
			"trigger.aria": "选择模型，当前 {model}",
			"trigger.ariaEffort": "选择模型，当前 {model}，推理等级 {effort}",
			"menu.aria": "选择模型面板",
			"menu.effort": "推理等级",
			"effort.providerDefault": "Default",
			"effort.stripAria": "推理等级，当前 {effort}",
			"head.summary": "{providers} 个提供商 · {models} 个模型",
			"search.placeholder": "搜索模型或提供商…",
			"search.aria": "搜索模型或提供商",
			"search.clear": "清除搜索",
			"search.resultsAria": "搜索结果",
			"search.empty": "没有匹配的模型或提供商。",
			"search.count": "{count} 个结果",
			"path.aria": "已选路径",
			"path.search": "搜索“{query}”",
			"path.select": "选择提供商与模型",
			"provider.aria": "提供商",
			"model.aria": "模型",
			"model.emptyTitle": "先选择一个提供商",
			"model.emptyHint": "在左侧选择后，这里会列出该提供商下的模型",
			"foot.move": "切换列内项",
			"foot.column": "切换列",
			"foot.select": "选择",
			"foot.close": "关闭",
			"foot.closeKey": "Esc",
			"status.loading": "正在刷新模型列表…",
			"error.action": "模型操作失败：{message}",
			"action.reload": "重新加载",
			"warning.groupLoad": "{name} 加载失败：{message}",
			"empty.models": "没有可用的模型。",
			"blocked.composer": "当前模型不可用，请先选择模型",
			"empty.efforts": "当前模型未提供推理等级。"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"command.label": "Model",
			"command.description": "Select the model for this conversation",
			"option.loadError": "Catalog failed to load: {message}",
			"trigger.fallback": "Select model",
			"trigger.loading": "Loading models…",
			"trigger.selectAria": "Select model",
			"trigger.aria": "Select model, current {model}",
			"trigger.ariaEffort": "Select model, current {model}, reasoning effort {effort}",
			"menu.aria": "Model selection panel",
			"menu.effort": "Effort",
			"effort.providerDefault": "Default",
			"effort.stripAria": "Reasoning effort, current {effort}",
			"head.summary": "{providers} providers · {models} models",
			"search.placeholder": "Search models or providers…",
			"search.aria": "Search models or providers",
			"search.clear": "Clear search",
			"search.resultsAria": "Search results",
			"search.empty": "No models or providers match.",
			"search.count": "{count} results",
			"path.aria": "Selected path",
			"path.search": "Search \"{query}\"",
			"path.select": "Select a provider and model",
			"provider.aria": "Providers",
			"model.aria": "Models",
			"model.emptyTitle": "Pick a provider first",
			"model.emptyHint": "Choose a provider on the left to list its models here",
			"foot.move": "Move within a column",
			"foot.column": "Switch column",
			"foot.select": "Select",
			"foot.close": "Close",
			"foot.closeKey": "Esc",
			"status.loading": "Refreshing model list…",
			"error.action": "Model operation failed: {message}",
			"action.reload": "Reload",
			"warning.groupLoad": "{name} failed to load: {message}",
			"empty.models": "No models available.",
			"blocked.composer": "This model is unavailable — select one to continue",
			"empty.efforts": "This model provides no reasoning effort levels."
		};
		//#endregion
		//#region src/client/index.ts
		/** One selectable row's id: an opaque row key (resolved by lookup, never parsed). */
		function rowId(providerId, modelId) {
			return `${providerId}/${modelId}`;
		}
		/** Flatten the directory into popup rows; failure rows are listed for visibility but never selectable. */
		function optionsOf(directory, t) {
			const rows = [];
			for (const group of directory.groups) for (const model of group.models) rows.push({
				id: rowId(group.id, model.id),
				label: model.name,
				detail: model.description !== void 0 ? `${group.name} · ${model.description}` : group.name,
				...directory.current !== null && directory.current.provider === group.id && directory.current.model === model.id ? { active: true } : {}
			});
			for (const failure of directory.failures) rows.push({
				id: `failure/${failure.id}`,
				label: failure.name,
				detail: t("option.loadError", { message: failure.message })
			});
			return rows;
		}
		/**
		* Resolve a picked row back to its model selection by matching against the loaded
		* groups (the same data the rows were built from — ids stay opaque).
		* @param state - the session's directory snapshot.
		* @param id - the picked row id.
		* @returns the row's model selection, or undefined for failure rows / stale ids.
		*/
		function selectionOf(state, id) {
			for (const group of state.groups) for (const model of group.models) {
				if (rowId(group.id, model.id) !== id) continue;
				const reasoningEffort = state.current?.provider === group.id && state.current.model === model.id ? state.current?.reasoningEffort ?? model.reasoning?.defaultEffort : model.reasoning?.defaultEffort;
				return {
					provider: group.id,
					model: model.id,
					...reasoningEffort === void 0 ? {} : { reasoningEffort }
				};
			}
		}
		/** Dictionary namespace owned by this plugin. */
		const NS = "model";
		/** Required services: the contribution registry, the seat's slot registry, locale, and the service's own faces. */
		const inject = [
			"commandUi",
			"locale",
			"sessions",
			"slots",
			"remote",
			"remote.session"
		];
		/**
		* Client plugin body: mount ModelDirectoryResolver, register the `model` dictionaries,
		* then register the /model popup contribution and the composer model seat
		* over the service.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-model-selection: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.plugin(ModelDirectoryResolver, { blockReason: () => t("blocked.composer") });
			ctx.inject(["commandUi", "modelDirectories"], (scope) => {
				const command = scope.get("commandUi");
				const models = scope.modelDirectories;
				const sessions = scope.sessions;
				scope.effect(() => command.register({
					name: "model",
					label: () => t("command.label"),
					description: () => t("command.description"),
					icon: _deepseek_ai_dsh_client_ui_primitives.IconDataOutlineRegular,
					available: (session) => sessions.subagentAddress(session.sessionId) === void 0,
					ui: {
						kind: "popupSelect",
						options: async (session) => {
							if (sessions.subagentAddress(session.sessionId) !== void 0) throw new Error("model selection is unavailable for addressed subagent sessions");
							return optionsOf(await models.directoryFor(session.sessionId).load(), t);
						},
						onSelect: async (option, session) => {
							if (sessions.subagentAddress(session.sessionId) !== void 0) throw new Error("model selection is unavailable for addressed subagent sessions");
							const directory = models.directoryFor(session.sessionId);
							const selection = selectionOf(directory.store.getSnapshot(), option.id);
							if (selection === void 0) throw new Error("this provider's catalog failed to load — pick a model from a loaded group");
							await directory.select(selection);
						}
					}
				}), "ui-model-selection: /model contribution");
			});
			ctx.inject(["slots", "modelDirectories"], (scope) => {
				const models = scope.modelDirectories;
				const sessions = scope.sessions;
				scope.slots.inject("conversation.input.model", () => scope.slots.register({
					name: "conversation.input.model",
					locale: NS,
					inject: (sessionId) => {
						const directory = models.directoryFor(sessionId);
						const available = sessions.subagentAddress(sessionId) === void 0;
						return {
							available,
							directory: directory.store,
							load: () => {
								if (available) directory.load().catch(() => {});
							},
							select: (selection) => available ? directory.select(selection).then(() => true, () => false) : Promise.resolve(false)
						};
					}
				}, ModelSelect));
			});
		}
		//#endregion
		exports.ModelDirectory = ModelDirectory;
		exports.ModelDirectoryResolver = ModelDirectoryResolver;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map