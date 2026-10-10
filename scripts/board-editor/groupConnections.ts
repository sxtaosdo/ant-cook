/** Decorative editor view only: group membership remains in the undoable draft. */
export interface ConnectionGroup { id: string; number: number; members: readonly string[] }
export interface AnchorRect { left: number; right: number; top: number; bottom: number }
export interface ConnectionViewport extends AnchorRect { width: number; height: number }
export interface ConnectionRoute {
  id: string; number: number; color: string; dash: string; path: string;
  anchors: { x: number; y: number }[]; label: { x: number; y: number };
}
const COLORS = ['#275c97', '#9b386a', '#7b581a', '#176a63', '#77489c', '#a13f28'];
const DASHES = ['', '7 3', '2 3'];
export function connectionStyle(number: number): { color: string; dash: string } {
  return { color: COLORS[(number - 1) % COLORS.length]!, dash: DASHES[Math.floor((number - 1) / COLORS.length) % DASHES.length]! };
}
/** Rectangles are in viewport CSS pixels; SVG coordinates are local layout pixels. */
export function connectionRoutes(groups: readonly ConnectionGroup[], rects: ReadonlyMap<string, AnchorRect>, viewport: ConnectionViewport): ConnectionRoute[] {
  const renderedWidth = viewport.right - viewport.left, renderedHeight = viewport.bottom - viewport.top;
  if (![renderedWidth, renderedHeight, viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)) return [];
  const scaleX = viewport.width / renderedWidth, scaleY = viewport.height / renderedHeight;
  const routes: ConnectionRoute[] = [];
  for (const group of groups) {
    const anchors = [...new Set(group.members)].flatMap(id => {
      const rect = rects.get(id);
      if (!rect || ![rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite) || rect.right <= rect.left || rect.bottom <= rect.top) return [];
      return [{ x: (rect.right - viewport.left) * scaleX, y: ((rect.top + rect.bottom) / 2 - viewport.top) * scaleY }];
    });
    if (anchors.length < 2) continue;
    // Column padding supplies a gutter outside the cards. The bus stays above headers.
    const busY = 16 + routes.length * 16, gutters = anchors.map(anchor => anchor.x + 5);
    const min = Math.min(...gutters), max = Math.max(...gutters);
    const branches = anchors.map((anchor, index) => `M ${anchor.x} ${anchor.y} H ${gutters[index]} V ${busY}`);
    routes.push({ id: group.id, number: group.number, ...connectionStyle(group.number), anchors,
      path: [`M ${min} ${busY} H ${max}`, ...branches].join(' '), label: { x: (min + max) / 2, y: busY - 2 } });
  }
  return routes;
}

export function mountGroupConnections(stage: HTMLElement, list: HTMLElement): { update(groups: readonly ConnectionGroup[], selectedId: string | null): void; dispose(): void } {
  const doc = stage.ownerDocument, view = doc.defaultView!, namespace = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(namespace, 'svg'); svg.classList.add('group-connections');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); svg.setAttribute('pointer-events', 'none'); stage.append(svg);
  let groups: readonly ConnectionGroup[] = [], selected: string | null = null, frame: number | null = null, disposed = false;
  const node = (name: 'path' | 'circle' | 'text', attributes: Record<string, string>): SVGElement => {
    const element = doc.createElementNS(namespace, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  };
  function draw(): void {
    frame = null; if (disposed) return;
    svg.replaceChildren();
    const bounds = stage.getBoundingClientRect(), width = stage.clientWidth, height = stage.clientHeight;
    const rects = new Map<string, AnchorRect>();
    for (const card of list.querySelectorAll<HTMLElement>('[data-block-id]')) rects.set(card.dataset.blockId!, card.getBoundingClientRect());
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    for (const route of connectionRoutes(groups, rects, { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width, height })) {
      const emphasized = route.id === selected, strokeWidth = emphasized ? '3' : '2';
      svg.append(node('path', { d: route.path, fill: 'none', stroke: route.color, 'stroke-width': strokeWidth, 'stroke-dasharray': route.dash, 'stroke-linejoin': 'round' }));
      for (const anchor of route.anchors) svg.append(node('circle', { cx: String(anchor.x), cy: String(anchor.y), r: '2.5', fill: route.color }));
      const label = node('text', { x: String(route.label.x), y: String(route.label.y), fill: route.color, 'text-anchor': 'middle' });
      label.textContent = String(route.number); svg.append(label);
    }
  }
  function schedule(): void { if (!disposed && frame === null) frame = view.requestAnimationFrame(draw); }
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  view.addEventListener('resize', schedule); view.addEventListener('scroll', schedule, true);
  view.visualViewport?.addEventListener('resize', schedule); view.visualViewport?.addEventListener('scroll', schedule);
  function dispose(): void {
    if (disposed) return; disposed = true;
    if (frame !== null) view.cancelAnimationFrame(frame);
    observer?.disconnect(); view.removeEventListener('resize', schedule); view.removeEventListener('scroll', schedule, true);
    view.visualViewport?.removeEventListener('resize', schedule); view.visualViewport?.removeEventListener('scroll', schedule);
    view.removeEventListener('unload', dispose); svg.remove();
  }
  view.addEventListener('unload', dispose, { once: true });
  return {
    update(next, selectedId): void {
      if (disposed) return;
      groups = next; selected = selectedId;
      const activeCount = next.filter(group => new Set(group.members).size >= 2).length;
      list.style.paddingTop = activeCount ? `${activeCount * 16 + 8}px` : '0px';
      // Clear stale lines immediately; remeasure the replaced card nodes next frame.
      svg.replaceChildren(); observer?.disconnect(); observer?.observe(stage); observer?.observe(list);
      for (const card of list.querySelectorAll<HTMLElement>('[data-block-id]')) observer?.observe(card);
      schedule();
    }, dispose,
  };
}
