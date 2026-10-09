import { GAME_COLORS, type DevelopmentLevelGroup } from '../../assets/Colony/scripts/application/levelCatalog.js';
import { draftDocument, importDraft, reflowGroups, rowMajorOrder, rulesFor, type LevelDraft } from './groupsCore.js';
import { documentFor, type PaletteColor } from './core.js';

interface Options {
  read(): LevelDraft; commit(draft: LevelDraft): void; markSaved(): void; locked(): boolean;
  palette: PaletteColor[]; message(text: string, error?: boolean): void;
}
export function mountGroupsEditor(options: Options): { render(): void } {
  const panel = document.createElement('section'); panel.className = 'panel groups-editor';
  panel.innerHTML = `<h2>数字组与初始规则</h2><p class="hint">队列列数独立于棋盘宽度与工作槽。问号到队首揭示；连体整组入槽；食物实际清除后取得钥匙。撤销恢复整份初始配置。</p>
    <div class="toolbar"><label>待选队列 <select data-control="queues"><option>3</option><option>4</option><option>5</option></select>列</label><label>目标主线关 <input data-control="level" type="number" min="1" max="60"></label><button data-action="add">添加数字组</button><button data-action="export">导出整份草稿</button><button data-action="import">导入整份草稿</button><input data-control="file" type="file" accept=".json" hidden></div>
    <div data-control="groups" class="group-columns"></div>
    <details><summary>格子顺序与钥匙</summary><p class="hint">改动棋盘后检查顺序。只有明确点击重建才使用行序；钥匙 ID 对应组的锁 ID。</p><button data-action="order">按行序重建格子顺序</button><textarea data-control="order" rows="3" aria-label="格子顺序"></textarea><div class="toolbar"><label>食物坐标 <input data-control="coordinate" placeholder="0.0"></label><label>钥匙 ID <input data-control="key" maxlength="64"></label><button data-action="key">添加或更新钥匙</button></div><div data-control="keys"></div></details>
    <details open><summary>验证与候选编译</summary><p data-control="validity" role="status"></p><label>解法组 ID（用 | 分隔）</label><textarea data-control="witness" rows="2" aria-label="显式解法顺序"></textarea><button data-action="witness">使用当前配置组顺序</button><p class="hint">连体后续成员由前一次原子选择覆盖。留空会进行有预算的稳定批次搜索；未证实为 UNKNOWN，不判不可解。</p><button data-action="preview" class="primary">编译仓外候选并验证</button><pre data-control="result"></pre><details><summary>审阅候选差异</summary><pre data-control="diff"></pre></details><p class="hint">确认只写入新建的隔离副本，不修改生产关卡或真实存档。</p><button data-action="apply" disabled>确认差异并导入隔离副本</button></details>`;
  document.querySelector('main')!.after(panel);
  const get = <T extends HTMLElement>(name: string): T => panel.querySelector(`[data-control="${name}"]`)! as T;
  const action = (name: string): HTMLButtonElement => panel.querySelector(`[data-action="${name}"]`)!;
  const queues = get<HTMLSelectElement>('queues'), level = get<HTMLInputElement>('level'), list = get<HTMLDivElement>('groups');
  const order = get<HTMLTextAreaElement>('order'), witness = get<HTMLTextAreaElement>('witness');
  const validity = get<HTMLParagraphElement>('validity'), result = get<HTMLPreElement>('result'), diff = get<HTMLPreElement>('diff');
  let busy = false, candidate: { id: string; confirmation: string; draft: string } | null = null;
  const run = (fn: () => void): void => { if (busy || options.locked()) return; try { fn(); } catch (error) { options.message(String(error instanceof Error ? error.message : error), true); } };
  const commit = (draft: LevelDraft): void => { candidate = null; result.textContent = ''; diff.textContent = ''; options.commit(draft); };
  function updateGroup(id: string, change: Partial<DevelopmentLevelGroup>): void {
    const draft = options.read(); draft.groups = reflowGroups(draft.groups.map(group => group.id === id ? { ...group, ...change } : group)); commit(draft);
  }
  const labelled = (label: string, node: HTMLElement): HTMLLabelElement => { const wrapper = document.createElement('label'); wrapper.append(label, node); return wrapper; };
  const smallButton = (text: string, onclick: () => void): HTMLButtonElement => { const button = document.createElement('button'); button.textContent = text; button.onclick = () => run(onclick); return button; };
  function render(): void {
    const draft = options.read(), locked = busy || options.locked();
    if (candidate && candidate.draft !== JSON.stringify(draft)) { candidate = null; result.textContent = '草稿已变化，请重新编译候选。'; diff.textContent = ''; }
    queues.value = String(draft.queueColumns); level.value = String(draft.targetLevel);
    order.value = draft.cellOrder.join('|'); witness.value = draft.selectionOrder.join('|');
    list.replaceChildren(); list.style.gridTemplateColumns = `repeat(${draft.queueColumns}, minmax(170px, 1fr))`;
    for (let pile = 0; pile < draft.queueColumns; pile++) {
      const column = document.createElement('div'), heading = document.createElement('h3'); heading.textContent = `第 ${pile + 1} 列 · 队首在上`; column.append(heading);
      for (const group of draft.groups.filter(group => group.pile === pile).sort((a, b) => a.depth - b.depth)) {
        const card = document.createElement('div'); card.className = 'group-card';
        const title = document.createElement('strong'); title.textContent = `${group.id} · 深度 ${group.depth}`; card.append(title);
        const color = document.createElement('select');
        options.palette.forEach((entry, index) => { const option = document.createElement('option'); option.value = entry.id; option.textContent = `${String.fromCharCode(65 + index)} ${entry.id}`; color.append(option); });
        color.value = group.color; color.style.borderLeft = `8px solid ${options.palette.find(value => value.id === group.color)?.hex ?? '#999'}`;
        color.onchange = () => run(() => updateGroup(group.id, { color: color.value as DevelopmentLevelGroup['color'] }));
        const count = document.createElement('input'); count.type = 'number'; count.min = '1'; count.max = '4096'; count.value = String(group.count);
        count.onchange = () => run(() => updateGroup(group.id, { count: Number(count.value) }));
        const target = document.createElement('select'); for (let index = 0; index < draft.queueColumns; index++) { const option = document.createElement('option'); option.value = String(index); option.textContent = `第 ${index + 1} 列`; target.append(option); }
        target.value = String(group.pile); target.onchange = () => run(() => updateGroup(group.id, { pile: Number(target.value) }));
        const mystery = document.createElement('input'); mystery.type = 'checkbox'; mystery.checked = Boolean(group.mystery);
        mystery.onchange = () => run(() => { const next = options.read(); const item = next.groups.find(item => item.id === group.id)!; if (mystery.checked) (item as {mystery?: true}).mystery = true; else delete (item as {mystery?: true}).mystery; commit(next); });
        card.append(labelled('真实颜色', color), labelled('真实数量', count), labelled('所在列', target), labelled('问号隐藏', mystery));
        for (const [field, label] of [['linkId', '连体 ID'], ['lockId', '锁 ID']] as const) {
          const input = document.createElement('input'); input.maxLength = 64; input.value = group[field] ?? '';
          input.onchange = () => run(() => { const next = options.read(), item = next.groups.find(item => item.id === group.id)! as {linkId?: string; lockId?: string}; if (input.value.trim()) item[field] = input.value.trim(); else delete item[field]; commit(next); });
          card.append(labelled(label, input));
        }
        const move = (direction: -1 | 1): void => { const next = options.read(), members = next.groups.filter(item => item.pile === group.pile); const neighbor = members[members.findIndex(item => item.id === group.id) + direction]; if (!neighbor) return; const a = next.groups.findIndex(item => item.id === group.id), b = next.groups.findIndex(item => item.id === neighbor.id); [next.groups[a], next.groups[b]] = [next.groups[b]!, next.groups[a]!]; next.groups = reflowGroups(next.groups); commit(next); };
        card.append(smallButton('上移', () => move(-1)), smallButton('下移', () => move(1)), smallButton('删除', () => { const next = options.read(); next.groups = reflowGroups(next.groups.filter(item => item.id !== group.id)); next.selectionOrder = []; commit(next); })); column.append(card);
      }
      list.append(column);
    }
    const keys = get<HTMLDivElement>('keys'); keys.replaceChildren();
    for (const [coordinate, id] of Object.entries(draft.cellKeys)) { const row = document.createElement('div'); row.append(`${coordinate} → ${id} `, smallButton('移除', () => { const next = options.read(); delete next.cellKeys[coordinate]; commit(next); })); keys.append(row); }
    try { rulesFor(draft); validity.textContent = candidate ? '配置合法；已证实一条稳定批次解法。' : '配置合法；可解性 UNKNOWN，等待见证回放。'; action('preview').disabled = locked; }
    catch (error) { validity.textContent = `配置待修正：${error instanceof Error ? error.message : String(error)}`; action('preview').disabled = true; }
    for (const control of panel.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')) control.disabled = locked;
    for (const button of panel.querySelectorAll<HTMLButtonElement>('button')) if (button !== action('preview') && button !== action('apply')) button.disabled = locked;
    action('apply').disabled = locked || !candidate;
  }
  queues.onchange = () => run(() => { const next = options.read(), value = Number(queues.value); if (next.groups.some(group => group.pile >= value)) throw new Error('请先把被删除列中的数字组移到保留列'); next.queueColumns = value as 3 | 4 | 5; commit(next); });
  level.onchange = () => run(() => { const next = options.read(); next.targetLevel = Number(level.value); commit(next); });
  order.onchange = () => run(() => { const next = options.read(); next.cellOrder = order.value.trim() ? order.value.trim().split('|') : []; commit(next); });
  witness.onchange = () => run(() => { const next = options.read(); next.selectionOrder = witness.value.trim() ? witness.value.trim().split('|') : []; commit(next); });
  action('order').onclick = () => run(() => { const next = options.read(); next.cellOrder = rowMajorOrder(next.board); commit(next); });
  action('witness').onclick = () => run(() => { const next = options.read(); next.selectionOrder = next.groups.map(group => group.id); commit(next); });
  action('add').onclick = () => run(() => { const next = options.read(); let index = 1; while (next.groups.some(group => group.id === `group-${index}`)) index++; next.groups.push({ id: `group-${index}`, color: GAME_COLORS[0], count: 1, pile: 0, depth: next.groups.filter(group => group.pile === 0).length }); next.selectionOrder = []; commit(next); });
  action('key').onclick = () => run(() => { const next = options.read(), coordinate = get<HTMLInputElement>('coordinate').value.trim(), key = get<HTMLInputElement>('key').value.trim(); if (!rowMajorOrder(next.board).includes(coordinate) || !/^[a-zA-Z0-9_-]{1,64}$/.test(key)) throw new Error('请输入有效食物坐标与钥匙 ID'); next.cellKeys[coordinate] = key; commit(next); });
  action('export').onclick = () => run(() => { const draft = options.read(), value = draftDocument(draft), url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = `level-${draft.targetLevel}-draft.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); options.markSaved(); options.message('已导出整份初始草稿'); });
  const file = get<HTMLInputElement>('file'); action('import').onclick = () => file.click();
  file.onchange = async () => { const chosen = file.files?.[0]; file.value = ''; if (!chosen || busy || options.locked()) return; busy = true; render(); try { if (chosen.size > 1024 * 1024) throw new Error('草稿不能超过1MB'); const draft = importDraft(JSON.parse(await chosen.text()) as unknown); commit(draft); options.markSaved(); options.message('已导入初始配置，不含运行状态'); } catch (error) { options.message(String(error instanceof Error ? error.message : error), true); } finally { busy = false; render(); } };
  action('preview').onclick = async () => {
    if (busy || options.locked()) return; const draft = options.read(); busy = true; candidate = null; render();
    try {
      const response = await fetch('/api/level/preview', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({board: documentFor(draft.board), rules: rulesFor(draft), level: draft.targetLevel}) });
      const data = await response.json() as {error?: string; id: string; confirmation: string; diff: string; outputRoot: string; validation: unknown; selectionOrder: number[]};
      if (!response.ok) throw new Error(data.error ?? '候选编译失败');
      if (JSON.stringify(options.read()) !== JSON.stringify(draft)) throw new Error('编译期间草稿已改变，请重新编译');
      if (draft.selectionOrder.length === 0) { draft.selectionOrder = data.selectionOrder.map(index => draft.groups[index]!.id); options.commit(draft); }
      candidate = {id: data.id, confirmation: data.confirmation, draft: JSON.stringify(draft)};
      result.textContent = JSON.stringify({候选目录: data.outputRoot, 验证: data.validation}, null, 2); diff.textContent = data.diff; options.message('候选已通过稳定批次见证；请审阅差异后决定导入隔离副本');
    } catch (error) { result.textContent = String(error instanceof Error ? error.message : error); options.message(result.textContent, true); }
    finally { busy = false; render(); }
  };
  action('apply').onclick = async () => {
    if (busy || !candidate || options.locked()) return; const value = candidate; busy = true; render();
    try { const response = await fetch('/api/level/apply', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: value.id, confirmation: value.confirmation})}); const data = await response.json() as {error?: string; imported?: unknown}; if (!response.ok) throw new Error(data.error ?? '隔离导入失败'); candidate = null; result.textContent += `\n${JSON.stringify(data, null, 2)}`; options.message('已导入隔离副本，生产关卡未写入'); }
    catch (error) { options.message(String(error instanceof Error ? error.message : error), true); } finally { busy = false; render(); }
  };
  render(); return {render};
}
