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
import {
  useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type KeyboardEvent, type FocusEvent, type RefObject,
} from 'react'
import clsx from 'clsx'
import type {
  ModelProviderGroup, ModelReasoningEffort, ModelSelection,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular,
  IconCloseOutlineRegular, IconSearchOutlineRegular, IconWarningOutlineRegular, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'
import css from './ModelSelect.module.css'

/** Which pane the panel shows: the cascade (browse/search) or the effort list. */
type Pane = 'browse' | 'effort'

/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
}

/** One flattened search hit: the provider group plus its matching model. */
interface SearchHit {
  group: ModelProviderGroup
  model: ModelProviderGroup['models'][number]
}

/**
 * Split `text` on every case-insensitive occurrence of `query` into marked
 * and plain segments; a blank query yields the whole text as one plain
 * segment.
 * @param text - the provider or model display name.
 * @param query - the trimmed search text.
 * @returns segments in document order; `matched` marks highlighted segments.
 */
function highlightSegments(
  text: string,
  query: string,
): ReadonlyArray<{ text: string; matched: boolean }> {
  if (query === '') return [{ text, matched: false }]
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const segments: Array<{ text: string; matched: boolean }> = []
  let cursor = 0
  while (cursor < text.length) {
    const at = lowerText.indexOf(lowerQuery, cursor)
    if (at === -1) {
      segments.push({ text: text.slice(cursor), matched: false })
      break
    }
    if (at > cursor) segments.push({ text: text.slice(cursor, at), matched: false })
    segments.push({ text: text.slice(at, at + query.length), matched: true })
    cursor = at + query.length
  }
  return segments
}

/**
 * Render the composer model seat.
 * @param props - owner share (locked) + injected face (shared directory
 * store/verbs) + the standard locale seat.
 * @returns the trigger and, while open, the cascade picker dialog.
 */
export function ModelSelect(
  { locked, available, directory, load, select, t }:
  ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('browse')
  const [query, setQuery] = useState('')
  // The active provider column; null until a group is picked (right-column
  // empty state per the spec). Re-derived at open from the durable selection.
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null)
  // The in-panel error strip serves catalog loads (its Retry re-runs the
  // load); a rejected SELECTION announces through the transient toast
  // instead, so the strip renders only while the latest failure-capable
  // action was a load.
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const effortStripRef = useRef<HTMLButtonElement | null>(null)
  const providerRefs = useRef<(HTMLButtonElement | null)[]>([])
  const modelRefs = useRef<(HTMLButtonElement | null)[]>([])
  const searchRefs = useRef<(HTMLButtonElement | null)[]>([])
  const effortRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  const currentChoice = useMemo(() => {
    if (state.current === null) return undefined
    for (const group of state.groups) {
      if (group.id !== state.current.provider) continue
      for (const model of group.models) {
        if (model.id !== state.current.model) continue
        return { group, model }
      }
    }
    return undefined
  }, [state.current, state.groups])
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('effort.providerDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined
    ? []
    : [
      ...reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
        : [],
      ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
      })),
    ], [reasoning, t])
  const searchQuery = query.trim()
  const searchHits = useMemo<readonly SearchHit[]>(() => {
    const needle = searchQuery.toLowerCase()
    if (needle === '') return []
    const hits: SearchHit[] = []
    for (const group of state.groups) {
      const providerHit = group.name.toLowerCase().includes(needle)
      for (const model of group.models) {
        if (providerHit || model.name.toLowerCase().includes(needle)) {
          hits.push({ group, model })
        }
      }
    }
    return hits
  }, [state.groups, searchQuery])
  const activeGroup = activeProviderId === null
    ? undefined
    : state.groups.find(group => group.id === activeProviderId)
  const busy = state.status === 'selecting'

  const reload = (): void => {
    lastActionRef.current = 'load'
    load()
  }

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  // Opening lands focus in the search field, like the spec's ⌘K surface.
  useEffect(() => {
    if (open && pane === 'browse') searchInputRef.current?.focus()
    // Runs on open only; pane changes keep the focus where the user is.
  }, [open])

  if (!available) return null

  const show = (): void => {
    // Open on the durable selection's provider when it is still advertised,
    // else on the first group; an empty directory shows the empty state.
    const currentAdvertised = state.groups.some(group => group.id === state.current?.provider)
    setPane('browse')
    setQuery('')
    setActiveProviderId(
      state.current?.provider !== undefined && currentAdvertised
        ? state.current.provider
        : state.groups[0]?.id ?? null,
    )
    setOpen(true)
    reload()
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('browse')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const collectRefs = (
    refs: RefObject<(HTMLButtonElement | null)[]>,
  ): (HTMLButtonElement | null)[] => refs.current?.filter(item => item !== null) ?? []

  const moveFocus = (items: (HTMLButtonElement | null)[], offset: number): void => {
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  /** Column arrows land on a column's first row (selected row keeps its order). */
  const focusFirstRow = (refs: RefObject<(HTMLButtonElement | null)[]>): void => {
    const items = collectRefs(refs)
    if (items.length > 0) items[0]?.focus()
  }

  const activeRows = (): (HTMLButtonElement | null)[] => {
    if (pane === 'effort') return collectRefs(effortRefs)
    if (searchQuery !== '') return collectRefs(searchRefs)
    const focusedIn = (refs: RefObject<(HTMLButtonElement | null)[]>): boolean =>
      collectRefs(refs).some(item => item === document.activeElement)
    if (focusedIn(modelRefs)) return collectRefs(modelRefs)
    return collectRefs(providerRefs)
  }

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      if (!open) return
      event.preventDefault()
      // Escape backs out of the search, then the effort drill-down, then closes.
      if (pane === 'browse' && searchQuery !== '') {
        setQuery('')
        searchInputRef.current?.focus()
        return
      }
      if (pane === 'effort') {
        setPane('browse')
        // The strip remounts with the breadcrumb; put focus back on it so the
        // blur never sees the focus drop out of the panel.
        queueMicrotask(() => { effortStripRef.current?.focus() })
        return
      }
      close(true)
      return
    }
    if (!open || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const items = activeRows()
      if (items.length === 0) return
      event.preventDefault()
      moveFocus(items, event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      // Inside the search field these keys move the text caret, not the columns.
      if (event.target === searchInputRef.current) return
      if (pane !== 'browse' || searchQuery !== '') return
      event.preventDefault()
      if (event.key === 'ArrowLeft') focusFirstRow(providerRefs)
      else if (activeGroup !== undefined) focusFirstRow(modelRefs)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }

  /**
   * The Host answers a selection either with a plain boolean or — since
   * 0.2.0-rc.2 — with a Result: `{ ok: true }`, `{ ok: false, error }`, or
   * `undefined` while the seat is unavailable. Both shapes are accepted so a
   * rejection always reaches the shared Toast.
   */
  const settleSelection = (
    result: boolean | { ok?: boolean, error?: { code: string, message: string } } | undefined,
  ): void => {
    if (result === undefined) return
    const accepted = typeof result === 'boolean' ? result : result.ok === true
    if (accepted) {
      if (rootRef.current !== null) close(true)
      return
    }
    const failure = typeof result === 'boolean' ? null : result.error ?? null
    const message = failure === null
      ? directory.getSnapshot().error
      : `${failure.code}: ${failure.message}`
    if (message !== null) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: t('error.action', { message }) })
    }
  }

  const choose = (selection: ModelSelection): void => {
    // Choosing a model ends the flow, so the panel closes with the click (the
    // previous two-level menu did the same when the effort level was chosen).
    // A rejected selection still announces itself through the shared Toast.
    lastActionRef.current = 'select'
    close(true)
    void select(selection).then(settleSelection)
  }

  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null) return
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    lastActionRef.current = 'select'
    close(true)
    void select(selection).then(settleSelection)
  }

  const waiting = state.current === null && state.status === 'loading'
  const modelLabel = waiting
    ? t('trigger.loading')
    : currentChoice?.model.name
      ?? (state.current === null ? t('trigger.fallback') : `${state.current.provider}/${state.current.model}`)
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  const triggerAria = waiting
    ? t('trigger.loading')
    : state.current === null
      ? t('trigger.selectAria')
      : effortLabel === undefined
        ? t('trigger.aria', { model: modelLabel })
        : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })

  // Roving rows are real focus targets; the refs rebuild with the lists each render.
  providerRefs.current = []
  modelRefs.current = []
  searchRefs.current = []
  effortRefs.current = []
  let providerIndex = 0
  let modelIndex = 0
  let searchIndex = 0
  let effortIndex = 0
  const providerRef = () => {
    const at = providerIndex++
    return (node: HTMLButtonElement | null) => { providerRefs.current[at] = node }
  }
  const modelRef = () => {
    const at = modelIndex++
    return (node: HTMLButtonElement | null) => { modelRefs.current[at] = node }
  }
  const searchRef = () => {
    const at = searchIndex++
    return (node: HTMLButtonElement | null) => { searchRefs.current[at] = node }
  }
  const effortRef = () => {
    const at = effortIndex++
    return (node: HTMLButtonElement | null) => { effortRefs.current[at] = node }
  }

  /** Derived two-letter provider badge (spec .cascade-mark): initials of the display name. */
  const providerMark = (name: string): string => {
    const words = name.split(/\s+/).filter(Boolean)
    if (words.length >= 2) return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase()
    return name.slice(0, 2).toUpperCase()
  }

  const providerRow = (group: ModelProviderGroup) => {
    const active = group.id === activeProviderId
    return (
      <button
        ref={providerRef()}
        type="button"
        role="option"
        aria-selected={active}
        className={clsx(css.row, active && css.rowActive)}
        key={group.id}
        title={group.name}
        disabled={busy}
        onClick={() => { setActiveProviderId(group.id) }}
      >
        <span className={css.providerMark} aria-hidden="true">{providerMark(group.name)}</span>
        <span className={css.providerName}>{group.name}</span>
        {group.models.length > 1 && <span className={css.providerCount}>{group.models.length}</span>}
        <IconChevronRightOutlineRegular className={css.providerArrow} />
      </button>
    )
  }

  const modelRow = (group: ModelProviderGroup, model: ModelProviderGroup['models'][number]) => {
    const selected = state.current?.provider === group.id && state.current.model === model.id
    return (
      <button
        ref={modelRef()}
        type="button"
        role="option"
        aria-selected={selected}
        className={clsx(css.row, selected && css.rowSelected)}
        key={model.id}
        title={model.name}
        disabled={busy}
        onClick={() => { choose({ provider: group.id, model: model.id }) }}
      >
        <span className={clsx(css.modelName, selected && css.modelNameSelected)}>{model.name}</span>
        <span className={css.rowCheck}>{selected ? <IconCheckOutlineRegular /> : null}</span>
      </button>
    )
  }

  const searchRow = (hit: SearchHit) => {
    const selected = state.current?.provider === hit.group.id && state.current.model === hit.model.id
    return (
      <button
        ref={searchRef()}
        type="button"
        role="option"
        aria-selected={selected}
        className={clsx(css.row, selected && css.rowSelected)}
        key={`${hit.group.id}/${hit.model.id}`}
        title={`${hit.group.name} › ${hit.model.name}`}
        disabled={busy}
        onClick={() => { choose({ provider: hit.group.id, model: hit.model.id }) }}
      >
        <span className={css.resultProvider}>
          {highlightSegments(hit.group.name, searchQuery).map((segment, at) => segment.matched
            ? <mark className={css.highlight} key={at}>{segment.text}</mark>
            : <span key={at}>{segment.text}</span>)}
        </span>
        <IconChevronRightOutlineRegular className={css.providerArrow} />
        <span className={clsx(css.modelName, selected && css.modelNameSelected)}>
          {highlightSegments(hit.model.name, searchQuery).map((segment, at) => segment.matched
            ? <mark className={css.highlight} key={at}>{segment.text}</mark>
            : <span key={at}>{segment.text}</span>)}
        </span>
        <span className={css.rowCheck}>{selected ? <IconCheckOutlineRegular /> : null}</span>
      </button>
    )
  }

  const strips = (
    <>
      {state.status === 'loading' && (
        <div className={css.status}>{t('status.loading')}</div>
      )}
      {state.error !== null && lastActionRef.current === 'load' && (
        <div className={css.error}>
          <span>{t('error.action', { message: state.error })}</span>
          <button type="button" className={css.retry} onClick={reload}>{t('action.reload')}</button>
        </div>
      )}
      {state.failures.map(failure => (
        <div className={css.warning} key={failure.id}>
          <span>{t('warning.groupLoad', { name: failure.name, message: failure.message })}</span>
          <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
        </div>
      ))}
    </>
  )

  const breadcrumb = (
    <nav className={css.path} aria-label={t('path.aria')}>
      {searchQuery === '' && activeGroup !== undefined && (
        <>
          <span className={css.pathNode}>{activeGroup.name}</span>
          <IconChevronRightOutlineRegular className={css.pathSep} />
        </>
      )}
      <span className={clsx(css.pathNode, css.pathNodeCurrent)}>
        {searchQuery !== ''
          ? t('path.search', { query: searchQuery })
          : activeGroup === undefined
            ? t('path.select')
            : state.current?.provider === activeGroup.id
              ? modelLabel
              : activeGroup.name}
      </span>
      <span className={css.pathStretch} />
      {searchQuery === '' && effortLabel !== undefined && (
        <button
          ref={effortStripRef}
          type="button"
          className={css.effortStrip}
          aria-label={t('effort.stripAria', { effort: effortLabel })}
          onClick={() => { setPane('effort') }}
        >
          <span>{effortLabel}</span>
          <IconChevronRightOutlineRegular className={css.effortStripChevron} />
        </button>
      )}
    </nav>
  )

  const modelColumn = activeGroup === undefined
    ? (
      <div className={css.emptyState}>
        <span className={css.emptyStateIcon} aria-hidden="true">
          <IconChevronRightOutlineRegular />
        </span>
        <p className={css.emptyStateTitle}>{t('model.emptyTitle')}</p>
        <p className={css.emptyStateHint}>{t('model.emptyHint')}</p>
      </div>
    )
    : activeGroup.models.length === 0
      ? <div className={css.empty}>{t('empty.models')}</div>
      : (
        <div className={css.column} role="listbox" aria-label={t('model.aria')}>
          {activeGroup.models.map(model => modelRow(activeGroup, model))}
        </div>
      )

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onPanelKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerLabel}
        disabled={locked}
        onClick={() => {
          if (open) {
            close()
          } else {
            show()
          }
        }}
      >
        {currentChoice !== undefined && <span className={css.triggerProvider}>{currentChoice.group.name}</span>}
        <span className={css.triggerLabel}>{modelLabel}</span>
        {effortLabel !== undefined && <span className={css.triggerEffort}>{effortLabel}</span>}
        <IconChevronDownOutlineRegular className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>

      {open && (
        <div
          id={`${id}-menu`}
          className={css.menu}
          role="dialog"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
          <header className={css.head}>
            <h2 className={css.headTitle}>{t('trigger.fallback')}</h2>
            <span className={css.headHint}>
              {pane === 'effort'
                ? null
                : searchQuery !== ''
                  ? t('search.count', { count: searchHits.length })
                  : t('head.summary', {
                    providers: state.groups.length,
                    models: state.groups.reduce((total, group) => total + group.models.length, 0),
                  })}
            </span>
          </header>

          {strips}

          {pane === 'effort' ? (
            effortChoices.length === 0
              ? <div className={css.empty}>{t('empty.efforts')}</div>
              : (
                <div className={css.column} role="listbox" aria-label={t('menu.effort')}>
                  {effortChoices.map(level => (
                    <button
                      ref={effortRef()}
                      type="button"
                      role="option"
                      aria-selected={effectiveEffort === level.effort}
                      className={clsx(css.row, effectiveEffort === level.effort && css.rowSelected)}
                      key={level.key}
                      disabled={busy}
                      onClick={() => { chooseEffort(level.effort) }}
                    >
                      <span className={clsx(css.modelName, effectiveEffort === level.effort && css.modelNameSelected)}>
                        {level.label}
                      </span>
                      <span className={css.rowCheck}>
                        {effectiveEffort === level.effort ? <IconCheckOutlineRegular /> : null}
                      </span>
                    </button>
                  ))}
                </div>
              )
          ) : (
            <>
              <div className={css.search}>
                <IconSearchOutlineRegular className={css.searchIcon} />
                <input
                  ref={searchInputRef}
                  type="text"
                  className={css.searchInput}
                  aria-label={t('search.aria')}
                  placeholder={t('search.placeholder')}
                  value={query}
                  onChange={(event) => { setQuery(event.target.value) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      const first = searchHits[0]
                      if (first !== undefined) {
                        event.preventDefault()
                        choose({ provider: first.group.id, model: first.model.id })
                      }
                    }
                  }}
                />
                {query !== '' && (
                  <button
                    type="button"
                    className={css.searchClear}
                    aria-label={t('search.clear')}
                    onClick={() => {
                      setQuery('')
                      searchInputRef.current?.focus()
                    }}
                  >
                    <IconCloseOutlineRegular size={12} />
                  </button>
                )}
              </div>
              {breadcrumb}
              {searchQuery !== ''
                ? searchHits.length === 0
                  ? <div className={css.empty}>{t('search.empty')}</div>
                  : (
                    <div className={css.column} role="listbox" aria-label={t('search.resultsAria')}>
                      {searchHits.map(searchRow)}
                    </div>
                  )
                : state.groups.length === 0
                  ? <div className={css.empty}>{t('empty.models')}</div>
                  : (
                    <div className={css.columns}>
                      <div className={css.column} role="listbox" aria-label={t('provider.aria')}>
                        {state.groups.map(providerRow)}
                      </div>
                      {modelColumn}
                    </div>
                  )}
            </>
          )}

          <footer className={css.foot}>
            <span className={css.keyHint}>
              <kbd className={css.kbd}>↑</kbd><kbd className={css.kbd}>↓</kbd>{t('foot.move')}
            </span>
            <span className={css.keyHint}>
              <kbd className={css.kbd}>←</kbd><kbd className={css.kbd}>→</kbd>{t('foot.column')}
            </span>
            <span className={css.keyHint}>
              <kbd className={css.kbd}>↵</kbd>{t('foot.select')}
            </span>
            <span className={css.keyHint}>
              <kbd className={css.kbd}>{t('foot.closeKey')}</kbd>{t('foot.close')}
            </span>
          </footer>
        </div>
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutlineRegular />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
