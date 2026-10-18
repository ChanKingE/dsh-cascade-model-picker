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
export const zh = {
  'command.label': '模型',
  'command.description': '选择本会话使用的模型',
  'option.loadError': '目录加载失败：{message}',
  'trigger.fallback': '选择模型',
  'trigger.loading': '正在加载模型…',
  'trigger.selectAria': '选择模型',
  'trigger.aria': '选择模型，当前 {model}',
  'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
  'menu.aria': '选择模型面板',
  'menu.effort': '推理等级',
  'effort.providerDefault': 'Default',
  'effort.stripAria': '推理等级，当前 {effort}',
  'head.summary': '{providers} 个提供商 · {models} 个模型',
  'search.placeholder': '搜索模型或提供商…',
  'search.aria': '搜索模型或提供商',
  'search.clear': '清除搜索',
  'search.resultsAria': '搜索结果',
  'search.empty': '没有匹配的模型或提供商。',
  'search.count': '{count} 个结果',
  'path.aria': '已选路径',
  'path.search': '搜索“{query}”',
  'path.select': '选择提供商与模型',
  'provider.aria': '提供商',
  'model.aria': '模型',
  'model.emptyTitle': '先选择一个提供商',
  'model.emptyHint': '在左侧选择后，这里会列出该提供商下的模型',
  'foot.move': '切换列内项',
  'foot.column': '切换列',
  'foot.select': '选择',
  'foot.close': '关闭',
  'foot.closeKey': 'Esc',
  'status.loading': '正在刷新模型列表…',
  'error.action': '模型操作失败：{message}',
  'action.reload': '重新加载',
  'warning.groupLoad': '{name} 加载失败：{message}',
  'empty.models': '没有可用的模型。',
  'blocked.composer': '当前模型不可用，请先选择模型',
  'empty.efforts': '当前模型未提供推理等级。',
} satisfies Record<string, string>

/** The model namespace key union. */
export type ModelKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'command.label': 'Model',
  'command.description': 'Select the model for this conversation',
  'option.loadError': 'Catalog failed to load: {message}',
  'trigger.fallback': 'Select model',
  'trigger.loading': 'Loading models…',
  'trigger.selectAria': 'Select model',
  'trigger.aria': 'Select model, current {model}',
  'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
  'menu.aria': 'Model selection panel',
  'menu.effort': 'Effort',
  'effort.providerDefault': 'Default',
  'effort.stripAria': 'Reasoning effort, current {effort}',
  'head.summary': '{providers} providers · {models} models',
  'search.placeholder': 'Search models or providers…',
  'search.aria': 'Search models or providers',
  'search.clear': 'Clear search',
  'search.resultsAria': 'Search results',
  'search.empty': 'No models or providers match.',
  'search.count': '{count} results',
  'path.aria': 'Selected path',
  'path.search': 'Search "{query}"',
  'path.select': 'Select a provider and model',
  'provider.aria': 'Providers',
  'model.aria': 'Models',
  'model.emptyTitle': 'Pick a provider first',
  'model.emptyHint': 'Choose a provider on the left to list its models here',
  'foot.move': 'Move within a column',
  'foot.column': 'Switch column',
  'foot.select': 'Select',
  'foot.close': 'Close',
  'foot.closeKey': 'Esc',
  'status.loading': 'Refreshing model list…',
  'error.action': 'Model operation failed: {message}',
  'action.reload': 'Reload',
  'warning.groupLoad': '{name} failed to load: {message}',
  'empty.models': 'No models available.',
  'blocked.composer': 'This model is unavailable — select one to continue',
  'empty.efforts': 'This model provides no reasoning effort levels.',
} satisfies Record<ModelKey, string>
