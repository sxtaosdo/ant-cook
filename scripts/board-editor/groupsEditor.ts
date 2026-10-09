import { GAME_COLORS, type DevelopmentLevelGroup } from '../../assets/Colony/scripts/application/levelCatalog.js';
import { draftDocument, importDraft, rowMajorOrder, rulesFor, type LevelDraft } from './groupsCore.js';
import { documentFor, type PaletteColor } from './core.js';
import { addBlock, basicExample, boardChangedSinceBlocks, changeBlock, clearBlocks, colorHex, colorLabel, createLinkGroup, dissolveLinkGroup, draftProblems, enterQueueConfiguration, friendlyError, generateBlocks, keyForBlock, linkGroupLabel, linkGroupsFor, moveBlock, prepareDraft, removeBlock, renderColorStatistics, toggleLinkMember, unlockBlock } from './groupsView.js';
import { openDraftPlaytest } from './playtest.js';

interface Options {
  read(): LevelDraft; commit(draft: LevelDraft): void; markSaved(): void; locked(): boolean;
  palette: PaletteColor[]; message(text: string, error?: boolean): void;
  pickFood(callback: (coordinate: string) => void): void; cancelFoodPick(): void;
}
export function mountGroupsEditor(options: Options): { render(): void; enterConfiguration(): void } {
  const panel = document.createElement('section'); panel.className = 'panel groups-editor'; panel.id = 'groups-editor';
  panel.innerHTML = `<h2>底部待选区</h2><p class="hint">每块的数字是要搬走的食物数量。同列从上往下出发；点击方块，在右侧修改。每种颜色的数字合计要与上方食物格数相同。</p>
    <div class="toolbar"><label>待选区 <select data-control="queues"><option>3</option><option>4</option><option>5</option></select>列</label><button data-action="generate" class="primary">按棋盘生成方块</button><button data-action="add">＋添加方块</button><button data-action="clear">全部删除</button><button data-action="example">载入普通示例</button><button data-action="export">保存整份草稿</button><button data-action="import">打开草稿</button><input data-control="file" type="file" accept=".json" hidden></div>
    <p data-control="generation" class="hint" role="status"></p><div data-control="statistics" class="color-statistics" aria-label="棋盘与待选数量对照"></div>
    <section class="link-panel" aria-label="一起出发分组"><h3>一起出发</h3><p class="hint">新建分组后，点方块加入或移出。每块只能属于一组；同列成员必须连续，出发时还要满足队首、钥匙和空槽规则。</p><div class="toolbar"><button data-action="new-link">＋新建组</button><button data-action="end-link">结束分组，编辑属性</button><button data-action="dissolve-link">解散当前组</button></div><div data-control="link-groups" class="link-group-tabs" role="group" aria-label="选择一起出发分组"></div><p data-control="link-status" role="status"></p><div data-control="link-members" class="link-members"></div></section>
    <p data-control="guide" class="editing-guide" role="status"></p>
    <div class="queue-layout"><div data-control="groups" class="group-columns"></div><aside data-control="properties" class="block-properties" aria-label="选中方块的属性"></aside></div>
    <div class="basic-validation"><p data-control="validity" role="status"></p><button data-action="check">检查关卡</button><button data-action="play" class="primary">试玩</button></div>
    <details class="advanced-settings"><summary>进阶操作：钥匙</summary><p class="hint">编号自动管理，无需输入。</p><div class="toolbar"><button data-action="key">放钥匙并关联方块</button><button data-action="cancel" hidden>取消当前操作</button></div></details>
    <details class="advanced-settings"><summary>高级设置：目标关、手动顺序、内部编号与候选编译</summary>
      <label>目标主线关 <input data-control="level" type="number" min="1" max="60"></label><p class="hint">基础试玩默认使用第7关的工作槽规则。目标关仅用于槽位规则和隔离候选，不会替换正式关卡。</p>
      <label><input data-control="manual" type="checkbox">手动指定食物顺序</label><button data-action="order">按当前图案重建食物顺序</button><textarea data-control="order" rows="3" aria-label="高级食物坐标顺序"></textarea>
      <label>指定解法的方块内部编号，用 | 分隔；留空自动寻找</label><textarea data-control="witness" rows="2" aria-label="高级解法顺序"></textarea><button data-action="witness">使用当前方块排列顺序</button>
      <details><summary>查看内部编号与钥匙坐标</summary><pre data-control="references"></pre></details>
      <p class="hint">编译检查只生成临时隔离候选；尚未找到解法时显示“暂时无法判断，仍需试玩”，不会误报可解或无解。</p><button data-action="preview">编译隔离候选并验证</button><p data-control="candidate-status" role="status"></p>
      <details><summary>技术回执与候选差异</summary><pre data-control="result"></pre><pre data-control="diff"></pre></details>
      <p class="hint">请先审阅差异。确认后只写入本轮新建的隔离副本，不写生产配置或真实存档。</p><button data-action="apply" disabled>确认差异并导入隔离副本</button>
    </details>`;
  document.querySelector('main')!.after(panel);
  const get = <T extends HTMLElement>(name: string): T => panel.querySelector(`[data-control="${name}"]`)! as T;
  const action = (name: string): HTMLButtonElement => panel.querySelector(`[data-action="${name}"]`)!;
  const queues = get<HTMLSelectElement>('queues'), level = get<HTMLInputElement>('level'), list = get<HTMLDivElement>('groups'), properties = get<HTMLElement>('properties');
  const order = get<HTMLTextAreaElement>('order'), witness = get<HTMLTextAreaElement>('witness'), manual = get<HTMLInputElement>('manual');
  const validity = get<HTMLParagraphElement>('validity'), guide = get<HTMLParagraphElement>('guide'), candidateStatus = get<HTMLParagraphElement>('candidate-status');
  const result = get<HTMLPreElement>('result'), diff = get<HTMLPreElement>('diff');
  let busy = false, selectedId: string | null = null, selectedLinkId: string | null = null, pickingKey = false, keyCoordinate: string | null = null;
  // Empty cellOrder means automatic; an explicit order is part of DraftHistory.
  const isManualOrder = (): boolean => options.read().cellOrder.length > 0;
  let candidate: { id: string; confirmation: string; draft: string } | null = null;
  const effective = (): LevelDraft => prepareDraft(options.read(), isManualOrder());
  const fail = (error: unknown): void => { const text = friendlyError(error); options.message(text, true); guide.textContent = text; };
  const run = (fn: () => void): void => { if (busy || options.locked()) return; try { fn(); } catch (error) { render(); fail(error); } };
  const commit = (draft: LevelDraft): void => { candidate = null; candidateStatus.textContent = ''; result.textContent = ''; diff.textContent = ''; options.commit(draft); };
  const cancelPlacement = (): void => { selectedLinkId = null; pickingKey = false; keyCoordinate = null; options.cancelFoodPick(); };
  const labelled = (label: string, node: HTMLElement): HTMLLabelElement => { const wrapper = document.createElement('label'); wrapper.append(label, node); return wrapper; };
  const smallButton = (text: string, fn: () => void): HTMLButtonElement => { const button = document.createElement('button'); button.textContent = text; button.onclick = () => run(fn); return button; };
  const confirmReplacement = (): boolean => !options.read().groups.length && !rowMajorOrder(options.read().board).length || window.confirm('这会替换当前草稿。请先用“保存整份草稿”保存未完成的修改。继续吗？');
  function appendBlock(pile: number): void { const next = addBlock(options.read(), pile); selectedId = next.groups.at(-1)!.id; commit(next); }
  function updateGroup(id: string, change: Partial<DevelopmentLevelGroup>): void { commit(changeBlock(options.read(), id, change)); }
  function chooseBlock(id: string): void {
    if (pickingKey) {
      if (!keyCoordinate) throw new Error('先点击上方一个有食物的格子，再点击要锁住的方块。');
      const next = keyForBlock(options.read(), keyCoordinate, id); cancelPlacement(); selectedId = id; commit(next); options.message('钥匙已关联。搬走标“钥”的食物后，这块才会解锁。');
    } else if (selectedLinkId) { const next = toggleLinkMember(options.read(), selectedLinkId, id); selectedId = id; commit(next); }
    else { selectedId = id; render(); }
  }
  function render(): void {
    const draft = effective(), locked = busy || options.locked(), manualOrder = isManualOrder();
    if (candidate && candidate.draft !== JSON.stringify(draft)) { candidate = null; candidateStatus.textContent = '草稿已变化，请重新编译候选。'; diff.textContent = ''; }
    if (!draft.groups.some(item => item.id === selectedId)) selectedId = draft.groups[0]?.id ?? null;
    const linkGroups = linkGroupsFor(draft);
    if (!linkGroups.some(group => group.id === selectedLinkId)) selectedLinkId = null;
    queues.value = String(draft.queueColumns); level.value = String(draft.targetLevel); manual.checked = manualOrder;
    order.value = draft.cellOrder.join('|'); witness.value = draft.selectionOrder.join('|');
    guide.textContent = selectedLinkId ? `正在编辑${linkGroupLabel(draft, selectedLinkId)}，点击方块加入或移出；点“结束分组，编辑属性”恢复属性选择。` : pickingKey ? keyCoordinate ? '钥匙位置已选好。现在点击下方要锁住的方块。' : '点击上方有食物的格子放钥匙，再点击下方要锁住的方块。' : draft.groups.length ? '点击彩色方块编辑属性；问号在编辑时保留真实颜色和数量，试玩时按游戏规则隐藏。' : '首次画好棋盘后点“完成棋盘，配置待选区 ↓”；也可以点“按棋盘生成方块”或手动添加。';
    action('cancel').hidden = !pickingKey;
    action('generate').textContent = draft.groups.length ? '按棋盘更新方块' : '按棋盘生成方块';
    get<HTMLParagraphElement>('generation').textContent = boardChangedSinceBlocks(draft) ? '棋盘已变化：已保留手调数量、问号、钥匙和分组。对照统计卡继续手调，或点“按棋盘更新方块”明确替换。' : '首次进入时按每种颜色的总数生成一块普通方块。数量一致不代表可通关；后续绘制不会覆盖手调结果。“全部删除”可撤销，删除后不会自动长回。';
    renderColorStatistics(get('statistics'), draft, options.palette);
    const tabs = get<HTMLDivElement>('link-groups'); tabs.replaceChildren();
    for (const link of linkGroups) { const tab = smallButton(`${linkGroupLabel(draft, link.id)} · ${link.members.length}块`, () => { cancelPlacement(); selectedLinkId = link.id; render(); }); tab.setAttribute('aria-pressed', String(selectedLinkId === link.id)); tabs.append(tab); }
    const selectedLink = linkGroups.find(link => link.id === selectedLinkId);
    get<HTMLParagraphElement>('link-status').textContent = selectedLink ? `${linkGroupLabel(draft, selectedLink.id)}：${selectedLink.members.length}块${selectedLink.members.length < 2 ? '，至少加入2块才能一起出发。' : '；再点成员可移出。'}` : linkGroups.length ? '选择上方分组查看成员；不同组以符号和编号区分。' : '还没有分组。点“＋新建组”，再点下方方块。';
    const linkMembers = get<HTMLDivElement>('link-members'); linkMembers.replaceChildren();
    for (const member of selectedLink?.members ?? []) linkMembers.append(smallButton(`${colorLabel(member.color)} · 第${member.pile + 1}列第${member.depth + 1}块 · 移出`, () => commit(toggleLinkMember(options.read(), selectedLink!.id, member.id))));
    list.replaceChildren(); list.style.gridTemplateColumns = `repeat(${draft.queueColumns}, minmax(90px, 1fr))`;
    for (let pile = 0; pile < draft.queueColumns; pile++) {
      const column = document.createElement('div'); column.className = 'queue-column';
      const heading = document.createElement('h3'); heading.textContent = `第${pile + 1}列`; column.append(heading);
      const members = draft.groups.filter(group => group.pile === pile).sort((a, b) => a.depth - b.depth);
      if (!members.length) { const empty = document.createElement('p'); empty.className = 'empty-column'; empty.textContent = '还没有方块'; column.append(empty); }
      for (const group of members) {
        const card = smallButton('', () => chooseBlock(group.id)); card.className = 'queue-block'; card.style.backgroundColor = colorHex(group.color, options.palette);
        const isMember = Boolean(selectedLinkId && group.linkId === selectedLinkId);
        if (selectedLinkId) card.classList.add(isMember ? 'link-member-selected' : 'link-member-dim');
        card.setAttribute('aria-pressed', String(selectedLinkId ? isMember : selectedId === group.id));
        card.setAttribute('aria-label', `第${pile + 1}列第${group.depth + 1}块，${colorLabel(group.color)}，${group.count}，${group.mystery ? '问号方块' : '普通方块'}${group.linkId ? `，${linkGroupLabel(draft, group.linkId)}` : ''}${group.lockId ? '，有锁' : ''}`);
        const number = document.createElement('strong'); number.textContent = group.mystery ? '?' : String(group.count);
        const name = document.createElement('span'); name.textContent = `${colorLabel(group.color)}${group.mystery ? ` · 问号 · 真实${group.count}` : ''}`;
        const badges = document.createElement('span'); badges.className = 'block-badges'; badges.textContent = `${group.linkId ? `${linkGroupLabel(draft, group.linkId)} ` : ''}${group.lockId ? '锁' : ''}`;
        card.append(number, name, badges); column.append(card);
      }
      const add = smallButton('＋添加', () => appendBlock(pile)); add.className = 'add-block'; column.append(add); list.append(column);
    }
    properties.replaceChildren();
    const group = draft.groups.find(item => item.id === selectedId);
    const title = document.createElement('h3'); title.textContent = group ? `第${group.pile + 1}列 · 第${group.depth + 1}块` : '方块属性'; properties.append(title);
    if (!group) { const hint = document.createElement('p'); hint.textContent = '先添加一块，或点击左侧方块。'; properties.append(hint); }
    else {
      const color = document.createElement('select');
      GAME_COLORS.forEach(id => { const option = document.createElement('option'); option.value = id; option.textContent = colorLabel(id); color.append(option); }); color.value = group.color;
      color.onchange = () => run(() => updateGroup(group.id, { color: color.value as DevelopmentLevelGroup['color'] }));
      const count = document.createElement('input'); count.type = 'number'; count.min = '1'; count.max = '4096'; count.value = String(group.count); count.onchange = () => run(() => updateGroup(group.id, { count: Number(count.value) }));
      const pile = document.createElement('select'); for (let index = 0; index < draft.queueColumns; index++) { const option = document.createElement('option'); option.value = String(index); option.textContent = `第${index + 1}列`; pile.append(option); } pile.value = String(group.pile); pile.onchange = () => run(() => updateGroup(group.id, { pile: Number(pile.value) }));
      const mystery = document.createElement('input'); mystery.type = 'checkbox'; mystery.checked = Boolean(group.mystery); mystery.onchange = () => run(() => { const next = options.read(); next.groups = next.groups.map(item => { if (item.id !== group.id) return item; const { mystery: _mystery, ...plain } = item; return mystery.checked ? { ...plain, mystery: true as const } : plain; }); next.selectionOrder = []; commit(next); });
      properties.append(labelled('颜色', color), labelled('数字（食物数量）', count), labelled('所在列', pile), labelled('问号方块（先隐藏颜色和数字）', mystery));
      const moves = document.createElement('div'); moves.className = 'toolbar'; moves.append(smallButton('上移', () => commit(moveBlock(options.read(), group.id, -1))), smallButton('下移', () => commit(moveBlock(options.read(), group.id, 1)))); properties.append(moves);
      if (group.linkId) properties.append(smallButton(`从${linkGroupLabel(draft, group.linkId)}移出`, () => commit(toggleLinkMember(options.read(), group.linkId!, group.id))));
      if (group.lockId) properties.append(smallButton('移除这块的锁', () => commit(unlockBlock(options.read(), group.id))));
      properties.append(smallButton('删除方块', () => commit(removeBlock(options.read(), group.id))));
    }
    const problems = draftProblems(draft);
    validity.textContent = problems.length ? problems.join('；') : '颜色和数量已匹配，结构检查通过。接下来点“试玩”检查实际出发顺序。';
    get<HTMLPreElement>('references').textContent = JSON.stringify({ groups: draft.groups, cellKeys: draft.cellKeys }, null, 2);
    for (const control of panel.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')) control.disabled = locked;
    for (const button of panel.querySelectorAll<HTMLButtonElement>('button')) button.disabled = locked;
    order.disabled = locked || !manualOrder;
    action('play').disabled = action('preview').disabled = locked || problems.length > 0;
    action('apply').disabled = locked || !candidate;
    action('end-link').disabled = action('dissolve-link').disabled = locked || !selectedLink;
    action('clear').disabled = locked || !draft.groups.length && !Object.keys(draft.cellKeys).length && !linkGroups.length;
  }
  queues.onchange = () => run(() => { const next = options.read(), value = Number(queues.value); if (next.groups.some(group => group.pile >= value)) throw new Error('先把即将删除列里的方块移到其他列，再减少列数。'); next.queueColumns = value as 3 | 4 | 5; commit(next); });
  level.onchange = () => run(() => { const next = options.read(); next.targetLevel = Number(level.value); commit(next); });
  manual.onchange = () => run(() => { const next = options.read(); next.cellOrder = manual.checked ? rowMajorOrder(next.board) : []; commit(next); });
  order.onchange = () => run(() => { const next = options.read(); next.cellOrder = order.value.trim() ? order.value.trim().split('|') : []; commit(next); });
  witness.onchange = () => run(() => { const next = options.read(); next.selectionOrder = witness.value.trim() ? witness.value.trim().split('|') : []; commit(next); });
  action('order').onclick = () => run(() => { const next = options.read(); next.cellOrder = rowMajorOrder(next.board); commit(next); });
  action('witness').onclick = () => run(() => { const next = options.read(); next.selectionOrder = next.groups.map(group => group.id); commit(next); });
  action('add').onclick = () => run(() => appendBlock(options.read().groups.find(item => item.id === selectedId)?.pile ?? 0));
  action('generate').onclick = () => run(() => { const current = options.read(); if ((current.groups.length || Object.keys(current.cellKeys).length || linkGroupsFor(current).length) && !window.confirm('这会替换全部待选方块及其问号、钥匙和一起出发分组，保留棋盘。可撤销；需要保留旧版本时请先保存整份草稿。继续更新吗？')) return; const next = generateBlocks(current); cancelPlacement(); selectedId = null; commit(next); options.message('已按各色总数生成普通方块，可继续拆分、调列和设置规则；数量一致仍需试玩。'); });
  action('clear').onclick = () => run(() => { cancelPlacement(); selectedId = null; commit(clearBlocks(options.read())); options.message('已删除全部待选方块及其关联，棋盘保留。可撤销；重新进入不会自动生成。'); });
  action('example').onclick = () => run(() => { if (!confirmReplacement()) return; cancelPlacement(); selectedId = null; const next = basicExample(); next.cellOrder = []; commit(next); options.message('普通示例已载入：两块莓红和一块柑橘，可直接点“试玩”。'); });
  action('new-link').onclick = () => run(() => { const created = createLinkGroup(options.read()); cancelPlacement(); selectedLinkId = created.id; commit(created.draft); });
  action('end-link').onclick = () => run(() => { cancelPlacement(); render(); });
  action('dissolve-link').onclick = () => run(() => { if (!selectedLinkId) return; const next = dissolveLinkGroup(options.read(), selectedLinkId); cancelPlacement(); commit(next); });
  action('key').onclick = () => run(() => { cancelPlacement(); pickingKey = true; options.pickFood(coordinate => { if (!pickingKey) return; keyCoordinate = coordinate; render(); options.message('现在点击下方要锁住的方块。'); }); render(); document.querySelector('#board')!.scrollIntoView({ block: 'center' }); });
  action('cancel').onclick = () => run(() => { cancelPlacement(); render(); });
  action('check').onclick = () => run(() => { const problems = draftProblems(effective()); options.message(problems.length ? problems.join('；') : '结构检查通过，尚未判断解法；请点“试玩”。', problems.length > 0); render(); });
  action('play').onclick = () => run(() => { cancelPlacement(); openDraftPlaytest(effective(), options.palette); render(); });
  action('export').onclick = () => run(() => { const draft = options.read(), value = draftDocument(draft), url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = `level-${draft.targetLevel}-draft.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); options.markSaved(); options.message('已保存整份草稿，包含食物图案、方块、问号、连体和钥匙。'); });
  const file = get<HTMLInputElement>('file'); action('import').onclick = () => run(() => file.click());
  file.onchange = async () => { const chosen = file.files?.[0]; file.value = ''; if (!chosen || busy || options.locked()) return; busy = true; render(); try { if (chosen.size > 1024 * 1024) throw new Error('草稿不能超过1MB'); const draft = importDraft(JSON.parse(await chosen.text()) as unknown); if (!confirmReplacement()) return; cancelPlacement(); selectedId = null; commit(draft); options.markSaved(); options.message('已打开初始草稿。'); } catch (error) { fail(error); } finally { busy = false; render(); } };
  action('preview').onclick = async () => {
    if (busy || options.locked()) return; const draft = effective(); busy = true; candidate = null; candidateStatus.textContent = '正在检查隔离候选…'; render();
    try {
      const response = await fetch('/api/level/preview', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({board: documentFor(draft.board), rules: rulesFor(draft), level: draft.targetLevel}) });
      const data = await response.json() as {error?: string; id: string; confirmation: string; diff: string; outputRoot: string; validation: {status: string}; selectionOrder: number[]};
      if (!response.ok) throw new Error(data.error ?? '候选检查失败');
      if (JSON.stringify(effective()) !== JSON.stringify(draft)) throw new Error('编译期间草稿已改变，请重新编译。');
      if (data.validation.status !== 'WITNESS_PASS_STABLE_BATCH') throw new Error('UNKNOWN');
      if (draft.selectionOrder.length === 0) { draft.selectionOrder = data.selectionOrder.map(index => draft.groups[index]!.id); const next = options.read(); next.selectionOrder = draft.selectionOrder; options.commit(next); }
      candidate = {id: data.id, confirmation: data.confirmation, draft: JSON.stringify(draft)};
      result.textContent = JSON.stringify({候选目录: data.outputRoot, 验证: data.validation}, null, 2); diff.textContent = data.diff;
      candidateStatus.textContent = '已找到一条通关顺序，仍需试玩和游戏画面验证。请先审阅候选差异。'; options.message(candidateStatus.textContent);
    } catch (error) { result.textContent = error instanceof Error ? error.message : String(error); candidateStatus.textContent = friendlyError(error); options.message(candidateStatus.textContent, true); }
    finally { busy = false; render(); }
  };
  action('apply').onclick = async () => {
    if (busy || !candidate || options.locked()) return; const value = candidate; busy = true; render();
    try { const response = await fetch('/api/level/apply', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: value.id, confirmation: value.confirmation})}); const data = await response.json() as {error?: string; imported?: unknown}; if (!response.ok) throw new Error(data.error ?? '隔离导入失败'); candidate = null; result.textContent += `\n${JSON.stringify(data, null, 2)}`; candidateStatus.textContent = '已导入本轮隔离副本。正式关卡和存档未写入。'; options.message(candidateStatus.textContent); }
    catch (error) { result.textContent += `\n${String(error)}`; fail(error); } finally { busy = false; render(); }
  };
  const enterConfiguration = (): void => run(() => { const current = options.read(), next = enterQueueConfiguration(current); cancelPlacement(); if (JSON.stringify(next) !== JSON.stringify(current)) { selectedId = null; commit(next); options.message('已按棋盘首次生成待选方块。对照统计卡修改，再检查和试玩。'); } else render(); });
  render(); return {render, enterConfiguration};
}
