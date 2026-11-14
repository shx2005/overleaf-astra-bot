// Keep actionable suggestions, but mount only the current one in the panel.
export class ReviewDeck {
  readonly element = document.createElement("div");
  private readonly slot = document.createElement("div");
  private readonly label = document.createElement("span");
  private readonly previous = document.createElement("button");
  private readonly next = document.createElement("button");
  private cards: HTMLElement[] = [];
  private active = -1;
  onChange: (visible: boolean) => void = () => {};
  constructor() {
    const navigation = document.createElement("div");
    navigation.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;gap:8px";
    this.previous.textContent = "上一处";
    this.next.textContent = "下一处";
    this.previous.onclick = (e) => {
      if (e.isTrusted)
        this.select(this.active < 0 ? this.cards.length - 1 : this.active - 1);
    };
    this.next.onclick = (e) => {
      if (e.isTrusted) this.select(this.active + 1);
    };
    navigation.append(this.previous, this.label, this.next);
    this.element.append(navigation, this.slot);
    this.render();
  }
  beginRound() {
    this.active = -1;
    this.render();
  }
  add(card: HTMLElement) {
    this.cards.push(card);
    this.active = this.cards.length - 1;
    this.render();
  }
  resolve(card: HTMLElement) {
    const index = this.cards.indexOf(card);
    if (index < 0) return;
    this.cards.splice(index, 1);
    if (index < this.active) this.active--;
    else if (index === this.active)
      this.active = Math.min(index, this.cards.length - 1);
    this.render();
  }
  private select(index: number) {
    if (index < 0 || index >= this.cards.length) return;
    this.active = index;
    this.render();
  }
  private render() {
    const current = this.cards[this.active];
    this.slot.replaceChildren(...(current ? [current] : []));
    this.label.textContent = current
      ? `当前修改 ${this.active + 1} / ${this.cards.length}`
      : this.cards.length
      ? `另有 ${this.cards.length} 处待处理`
      : "暂无待处理修改";
    this.previous.disabled = !this.cards.length || this.active === 0;
    this.next.disabled =
      !this.cards.length || this.active === this.cards.length - 1;
    this.onChange(Boolean(current));
  }
}
