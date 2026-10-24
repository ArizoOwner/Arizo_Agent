// The island: DOM shell, sizing animation, Ari placement, mouse handling.

import { Tracked, Spring, clamp } from "../core/anim";
import { Bridge, IS_TAURI } from "../core/bridge";
import {
  EXPANDED_CORNER, EXPANDED_W, NOTCH_W, PANEL_H, PANEL_W, TRANSLATE_MAX_W, VIEW_LAYOUTS,
  ROUNDED_CORNER, botGlowColor, botGlowOpacity, botPosition, compactLayout, compactSize, islandSize,
  type CompactLayout,
  type BotEmoteName, type IslandMode, type IslandViewName,
} from "../core/layout";
import { DEFAULT_LOOK, LOOK, PANEL_STEP, applyLookVars, cornerRadius, floatOffset, lookOf, panelFor, scaledIsland, type IslandExtent, type Look } from "../core/appearance";
import { onEmote } from "../core/mood";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import { Spotify, SPOTIFY_GREEN, SPOTIFY_ID, islandDances, musicPlaying } from "../core/spotify";
import {
  CELEBRATION_MS, EVENT_STYLE, FOOTBALL_COLOR, FOOTBALL_ID, Football, ariCheers, ariGloomy, celebrating, celebrationLevel, celebrationSize,
  kitForState, makeRain, onFootballEvent, styleOf,
  type Celebration, type FootballEvent, type GoalInfo,
} from "../core/football";
import { BotEngine } from "../ari/engine";
import { GREETING_H, GREETING_W, Greeting } from "../ari/greeting";
import { createMiniBot, pruneMiniBots, syncMiniBotStates, tickMiniBots, type MiniTask } from "../ari/minibots";
import { SeasonCache, parseOutfit } from "../ari/wardrobe";
import { buildHeader, buildViews, type ViewActions, type ViewHost } from "../views/views";
import type { TranslateHost } from "../views/translate";
import type { HistoryItem } from "../core/history-logic";
import { onToast } from "../core/toast";
import { h } from "../views/dom";
import { IslandStateMachine } from "./fsm";
import { isRtl, language, t } from "../i18n/i18n";

const BOT_OVERHANG = 40;
/** Extra canvas on each side of Ari, for the witch hat's brim and the Santa hat's tip. */
const BOT_SIDE = 24;
/** Margin around the island that still counts as "on" it (the backend uses the same). */
const HIT_MARGIN = 14;

/** Room the island's shadow wants on each side of it inside the window. */
const SHADOW_ROOM = 20;
/** How long a shrinking window waits for the island to finish shrinking first. */
const PANEL_SHRINK_DELAY_MS = 700;

const modeOrder = (m: IslandMode) => (m === "hidden" ? 0 : m === "compact" ? 1 : 2);

/** The biggest the island can be at the default look: the translator at its widest and tallest, and the tallest fixed view. */
const LARGEST: readonly IslandExtent[] = [
  { w: TRANSLATE_MAX_W, h: PANEL_H, fitsContent: true },
  {
    w: EXPANDED_W,
    h: Math.max(...Object.entries(VIEW_LAYOUTS).filter(([name]) => name !== "translate" && name !== "greeting").map(([, v]) => v.height)),
    fitsContent: false,
  },
];

export class Island {
  readonly fsm = new IslandStateMachine();

  private root: HTMLElement;
  private islandEl!: HTMLElement;
  private clipEl!: HTMLElement;
  private contentEl!: HTMLElement;
  private viewsEl!: HTMLElement;
  private botCanvas!: HTMLCanvasElement;
  private botGlow!: HTMLElement;
  private greetingCanvas!: HTMLCanvasElement;
  private miniGrid!: HTMLElement;
  private capsuleText!: HTMLElement;
  /** The rows of mini Aris in the capsule (two columns), and the clock's line height: both set the capsule's layout. */
  private miniRows = 2;
  private clockH = 16;
  private compactStyleKey = "";
  private toastEl!: HTMLElement;
  private countdown!: HTMLElement;
  private wakeStrip!: HTMLElement;

  private header!: ViewHost;
  private views!: Map<IslandViewName, ViewHost>;
  readonly translate!: TranslateHost;

  private width = new Tracked(NOTCH_W);
  private height = new Tracked(0);
  private radius = new Tracked(ROUNDED_CORNER);
  /** How far the island hangs below the top edge (0 unless it floats: Settings → Island look). */
  private top = new Tracked(0);
  /**
   * While a width slider is dragged the slider sits inside the island, which is centred: as the island
   * widens the slider would slide away from under the pointer. So the edge the slider is near stays where
   * it was and the island grows from the other one; letting go eases it back to the centre.
   */
  private anchor: { w0: number; rtl: boolean } | null = null;
  private shiftX = new Tracked(0);
  private botCx = new Spring(46);
  private botCy = new Spring(16);
  private botSize = new Spring(10);

  private engine = new BotEngine();
  private greeting = new Greeting();
  private greetingShown = false;
  private seasons = new SeasonCache();

  private running = false;
  private lastFrame = 0;
  private dirty = true;
  private canvasPx = 0;

  // The backend starts the window at full size so the launch greeting has room.
  private collapsed = false;
  private collapseTimer: number | null = null;
  private wasInIsland = false;
  /** Last shape handed to the backend for the click-through test. */
  private pushedRect = { x: -1, y: -1, w: -1, h: -1 };

  /** The island's look (Settings → Island look) and the size of the window it needs. */
  private look: Look = DEFAULT_LOOK;
  private lookKey = "";
  /** The size of the window as the backend has it now (the default until the look needs more). */
  private panel = { w: PANEL_W, h: PANEL_H };
  private panelTimer: number | null = null;

  // Bot hover → love
  private botHovering = false;
  private botHoverTimer: number | null = null;
  private lastLoveTime = 0;
  private botHoverStart = { x: 0, y: 0 };

  private confusedRecovery: number | null = null;
  private lastSyncedView: IslandViewName | null = null;
  private cryptoReported = false;
  private toastTimer: number | null = null;

  // The goal celebration: the island grows, rains balls and confetti, then returns.
  private celebration: (Celebration & { event?: FootballEvent }) | null = null;
  private goalLayer!: HTMLElement;
  private celebrationLevelNow = 0;
  /** Events that came while another show was running; played in turn. */
  private showQueue: FootballEvent[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    this.build();
    this.wireFsm();
    this.wireInput();
    this.engine.onDizzy = () => this.handleDizzy();
    this.greeting.onComplete = () => this.fsm.greetComplete();
    onEmote((e) => this.emote(e));
    onToast((m, ms) => this.showToast(m, ms));
    onFootballEvent((e) => this.celebrateEvent(e));
    State.subscribe(() => {
      this.dirty = true;
      this.ensureRunning();
    });
  }

  // ── DOM ─────────────────────────────────────────────────────────────────────

  private build() {
    const actions: ViewActions = {
      setView: (v) => this.setView(v),
      collapse: () => this.collapse(),
      toggleSound: () => {
        State.settings.soundEnabled = !State.settings.soundEnabled;
        Sound.setEnabled(State.settings.soundEnabled);
        void Bridge.saveSettings({ soundEnabled: State.settings.soundEnabled });
        State.notify();
      },
      setVolume: (v) => {
        State.settings.soundVolume = v;
        Sound.setVolume(v);
        void Bridge.saveSettings({ soundVolume: v });
        State.notify();
      },
      previewVolume: (v) => Sound.setVolume(v),
      previewLook: (patch) => {
        if (patch && "uiWidth" in patch && !this.anchor) {
          this.anchor = { w0: this.width.value, rtl: isRtl() };
          this.updatePanel();
        }
        State.lookPreview = patch;
        this.applyLook();
      },
      setLook: (patch) => {
        this.releaseAnchor();
        State.lookPreview = null;
        State.settings = { ...State.settings, ...patch };
        void Bridge.saveSettings(patch);
        this.applyLook();
        State.notify();
      },
      setFeatureOrder: (order) => {
        State.settings.featureOrder = order;
        void Bridge.saveSettings({ featureOrder: order });
        State.notify();
      },
      playSound: (name) => void Sound.play(name),
      setAutoClose: (s) => {
        State.settings.autoCloseInterval = s;
        this.fsm.homeToPetitDelay = s;
        void Bridge.saveSettings({ autoCloseInterval: s });
        State.notify();
      },
      openSettingsWindow: () => this.setView("settings"),
      blip: () => Sound.play("blip"),
      chooseOutfit: (selection) => {
        State.wardrobePreview = null;
        State.settings.ariOutfit = selection;
        void Bridge.saveSettings({ ariOutfit: selection });
        Sound.play("pop");
        this.engine.triggerEmote("proud");
        State.notify();
      },
      previewOutfit: (outfit) => {
        State.wardrobePreview = outfit;
        State.notify();
      },
      // The translate view grows and shrinks with its text: closing the gap back to
      // a short phrase uses the no-overshoot curve, growing uses the spring.
      heightChanged: () => {
        const { w, h } = this.targetSize();
        this.animateGeometry(h < this.height.value || w < this.width.value);
      },
      retranslate: (item: HistoryItem) => {
        this.setView("translate");
        this.translate.setText(item.query, item.targetLang);
      },
    };

    this.wakeStrip = h("div", { id: "wake-strip" });
    this.botGlow = h("div", { id: "bot-glow" });
    this.botCanvas = h("canvas", { id: "bot-canvas" });
    this.greetingCanvas = h("canvas", { id: "greeting-canvas" });
    this.miniGrid = h("div", { id: "mini-grid" });
    this.capsuleText = h("div", { id: "capsule-text", dir: "auto" });
    this.toastEl = h("div", { id: "toast" });
    this.countdown = h("div", { id: "countdown" });
    this.goalLayer = h("div", { id: "goal-layer", "aria-hidden": "true" });

    this.header = buildHeader(actions);
    const built = buildViews(actions, () => this.closeAfterAction());
    this.views = built.map;
    (this as { translate: TranslateHost }).translate = built.translate;
    this.viewsEl = h("div", { id: "views" });
    for (const v of this.views.values()) this.viewsEl.append(v.el);
    this.contentEl = h("div", { id: "content" }, this.header.el, this.viewsEl);

    this.clipEl = h("div", { id: "island-clip" }, this.greetingCanvas, this.contentEl);
    this.islandEl = h(
      "div",
      { id: "island" },
      this.clipEl,
      this.botGlow,
      this.botCanvas,
      this.miniGrid,
      this.capsuleText,
      this.toastEl,
      this.countdown,
      this.goalLayer,
    );

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.greetingCanvas.width = Math.round(GREETING_W * dpr);
    this.greetingCanvas.height = Math.round(GREETING_H * dpr);
    this.greetingCanvas.style.width = `${GREETING_W}px`;
    this.greetingCanvas.style.height = `${GREETING_H}px`;

    this.root.append(this.wakeStrip, this.islandEl);
    this.applyGeometry();
  }

  // ── FSM ─────────────────────────────────────────────────────────────────────

  private wireFsm() {
    this.fsm.homeToPetitDelay = State.settings.autoCloseInterval;
    this.fsm.onTransition = (from, to) => {
      switch (to) {
        case "hidden":
          this.setMode("hidden");
          break;
        case "petit":
          if (from === "greet") this.greeting.interrupt();
          else if (from === "hidden") Sound.play("peek");
          this.setMode("compact");
          if (from === "greet") State.view = State.defaultView();
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        case "home":
          this.expand(State.view === "greeting" ? State.defaultView() : State.view);
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        case "greet":
          this.expand("greeting");
          this.greeting.start();
          break;
      }
      State.notify();
    };
  }

  launch() {
    this.fsm.launch();
  }

  // ── Mode / view ─────────────────────────────────────────────────────────────

  private setMode(mode: IslandMode) {
    const prev = State.mode;
    if (mode === prev) return;
    State.mode = mode;
    if (mode === "expanded") Sound.play("open");
    if (prev === "expanded") {
      Sound.play("close");
      State.isPinned = false;
      void Bridge.focusWindow(false);
    }
    if (mode !== "expanded") this.engine.resetMorph();
    this.updateWindowCollapsed();
    this.animateGeometry(modeOrder(mode) < modeOrder(prev));
    State.notify();
  }

  expand(view: IslandViewName) {
    State.view = view;
    if (State.mode !== "expanded") this.setMode("expanded");
    else this.animateGeometry(false);
    State.lastActivity = performance.now();
    State.notify();
  }

  setView(view: IslandViewName) {
    if (State.mode !== "expanded") {
      this.fsm.forceHome();
      State.view = view;
      this.animateGeometry(false);
      State.notify();
      return;
    }
    const grew = this.viewHeight(view) >= this.viewHeight(State.view);
    State.view = view;
    State.lastActivity = performance.now();
    this.animateGeometry(!grew);
    State.notify();
  }

  private viewHeight(view: IslandViewName): number {
    return this.sizeOf("expanded", view).h;
  }

  collapse() {
    State.isPinned = false;
    this.fsm.pinned = false;
    // Drive the state machine rather than the mode: setting the mode behind its
    // back would leave it thinking the island was still open, and a click on
    // the compact island would then do nothing.
    // Any outside click lands here: only an open island has anything to fold, or
    // a hidden one would reappear and the compact one lose its hide timer.
    if (State.mode === "expanded") this.fsm.forcePetit();
  }

  /** A copy or replace is done: the island folds (the window is click-through, nothing to give back). */
  private closeAfterAction() {
    this.collapse();
  }

  /** The tray or the hotkey: open on this view. */
  alert(view: IslandViewName) {
    this.fsm.pinned = State.isPinned;
    this.fsm.forceHome();
    // Already home: forceHome cleared the countdown and onTransition will not re-arm it.
    if (!this.wasInIsland) this.fsm.mouseLeft();
    this.expand(view);
  }

  // ── Goal celebration ───────────────────────────────────────────────────────

  /**
   * The favourite team scored: the island opens if it was folded, grows into a
   * stage, rains balls and confetti while Ari cheers, then goes back.
   */
  celebrateGoal(info: GoalInfo) {
    this.celebrateEvent({ kind: "goal", teamName: info.teamName, opponent: info.opponent, player: info.player, minute: "", score: info.score, count: 1 });
  }

  /**
   * Something happened in the game (a goal, a card, kick-off, the final whistle):
   * the island grows into a stage that fits it, Ari reacts, and it goes back.
   * An event that arrives during a show waits its turn, unless it matters more.
   */
  celebrateEvent(e: FootballEvent) {
    const style = EVENT_STYLE[e.kind];
    const now = performance.now();
    if (this.celebration && celebrating(this.celebration, now)) {
      if (style.priority <= styleOf(this.celebration).priority) {
        if (this.showQueue.length < 5) this.showQueue.push(e);
        return;
      }
      this.showQueue.unshift(this.celebration.event ?? e);
    }
    this.startShow(e);
  }

  private startShow(e: FootballEvent) {
    const style = EVENT_STYLE[e.kind];
    // From the hidden strip the window is only 240×6 px: open it first (setMode does,
    // below), and keep the island from folding away again while the show runs.
    if (State.mode === "hidden") this.fsm.reveal();
    this.fsm.holdPetit();
    const now = performance.now();
    this.celebration = {
      startedAt: now, kind: e.kind, ms: style.ms, event: e,
      teamName: e.teamName, player: e.player, score: e.score, opponent: e.opponent,
    };
    this.buildGoalLayer(e);
    State.lastActivity = now;
    Sound.play(style.sound);
    this.engine.triggerEmote(style.emote, 3);
    this.ensureRunning();
    State.notify();
  }

  private buildGoalLayer(e: FootballEvent) {
    const style = EVENT_STYLE[e.kind];
    const layer = this.goalLayer;
    layer.classList.remove("on");
    layer.className = "tone-" + style.tone;
    layer.replaceChildren();
    void layer.offsetWidth; // restart the CSS animations
    const drops = style.rain === "none" ? [] : makeRain(style.rain === "party" ? 46 : 26, this.panel.w - 140, 20261017 + style.priority, style.ms);
    const word = t(style.word) + (e.count > 1 ? " ×" + e.count : "");
    const who = [e.player, e.minute].filter(Boolean).join("  ");
    layer.append(
      h("div", { class: "goal-glow" }),
      ...drops.map((d) => {
        const kind = style.rain === "party" ? d.kind : style.rain === "balls" ? "ball" : style.rain;
        const drop = h("i", { class: "goal-drop goal-" + kind });
        drop.style.left = d.x + "px";
        drop.style.width = drop.style.height = d.size + "px";
        if (kind === "cardY" || kind === "cardR") drop.style.height = d.size * 1.4 + "px";
        drop.style.setProperty("--delay", Math.round(d.delay) + "ms");
        drop.style.setProperty("--fall", Math.round(d.fall) + "ms");
        drop.style.setProperty("--spin", Math.round(d.spin) + "deg");
        drop.style.setProperty("--sway", Math.round((d.hue % 90) - 45) + "px");
        if (kind === "confetti" || kind === "star") drop.style.background = "hsl(" + d.hue + " 90% 60%)";
        return drop;
      }),
      h("div", { class: "goal-banner" },
        h("div", { class: "goal-word" + (word.length > 14 ? " small" : ""), text: word, dir: "auto" }),
        who ? h("div", { class: "goal-player", text: who, dir: "auto" }) : null,
        e.score ? h("div", { class: "goal-score", text: e.teamName + "  " + e.score + "  " + e.opponent, dir: "auto" }) : null),
    );
    layer.classList.add("on");
  }

  private stepCelebration(nowMs: number) {
    const before = this.celebrationLevelNow;
    // A frame's clock can be a hair older than the moment an event started its show
    // (events arrive between frames): that is "not started yet", never "already over".
    const over = this.celebration != null && nowMs - this.celebration.startedAt >= (this.celebration.ms ?? CELEBRATION_MS);
    this.celebrationLevelNow = celebrationLevel(this.celebration, nowMs);
    if (this.celebration && over) {
      this.celebration = null;
      this.celebrationLevelNow = 0;
      this.goalLayer.classList.remove("on");
      this.goalLayer.replaceChildren();
      this.engine.cheering = false;
      this.engine.gloomy = false;
      this.fsm.releasePetit();
      this.dirty = true;
      const next = this.showQueue.shift();
      if (next) this.startShow(next);
      else this.engine.triggerEmote("happy");
    }
    if (before !== this.celebrationLevelNow) this.dirty = true;
  }

  /** Esc: folds the island. */
  close() {
    this.collapse();
  }

  reveal() {
    this.fsm.reveal();
  }

  /** Right-click on Ari: wardrobe open, and back to the usual view. */
  toggleWardrobe() {
    if (State.mode === "hidden") return;
    // The greeting draws an Ari of its own.
    if (State.mode === "expanded" && State.view === "greeting") return;
    if (State.mode === "expanded" && State.view === "wardrobe") this.setView(State.defaultView());
    else this.setView("wardrobe");
  }

  /** The hotkey or the tray brought selected text: open on the translate view with it. */
  openWithText(text: string) {
    this.alert("translate");
    this.translate.setCaptured(text);
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────

  emote(name: BotEmoteName) {
    this.engine.triggerEmote(name);
    this.ensureRunning();
  }

  /** Ctrl+M: fold the island to its compact capsule, or open it again. */
  toggleCompact() {
    if (State.mode === "expanded") this.collapse();
    else if (State.mode === "compact") this.fsm.click();
  }

  /** The island takes the keyboard (a text field is being edited). */
  takeKeyboard() {
    void Bridge.focusWindow(true);
  }

  private showToast(message: string, ms: number) {
    this.toastEl.textContent = message;
    this.toastEl.classList.add("on");
    if (this.toastTimer != null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove("on");
      this.toastTimer = null;
    }, ms);
  }

  // ── Geometry ────────────────────────────────────────────────────────────────

  private targetSize(): { w: number; h: number; r: number; t: number } {
    const { w, h } = this.sizeOf(State.mode, State.view);
    const r = cornerRadius(State.mode === "expanded" ? EXPANDED_CORNER : ROUNDED_CORNER, this.look);
    return { w, h, r, t: floatOffset(this.look, State.mode === "hidden") };
  }

  /** The size to draw now: the target, stretched toward the stage while a goal is celebrated. */
  private drawnSize(w: number, h: number): { w: number; h: number } {
    return this.celebrationLevelNow > 0.001
      ? celebrationSize({ w, h }, this.celebrationLevelNow, this.panel, styleOf(this.celebration).stage)
      : { w, h };
  }

  private animateGeometry(shrinking: boolean) {
    const { w, h, r, t } = this.targetSize();
    if (shrinking) {
      this.width.curveTowards(w);
      this.height.curveTowards(h);
      this.radius.curveTowards(r);
      this.top.curveTowards(t);
    } else {
      this.width.springTo(w);
      this.height.springTo(h);
      this.radius.springTo(r);
      this.top.springTo(t);
    }
    this.ensureRunning();
  }

  private applyGeometry() {
    const shown = this.drawnSize(this.width.value, this.height.value);
    const w = shown.w;
    const hh = shown.h;
    const r = this.celebrationLevelNow > 0.001 ? Math.max(this.radius.value, cornerRadius(EXPANDED_CORNER, this.look)) : this.radius.value;
    this.islandEl.style.width = `${w}px`;
    this.islandEl.style.height = `${hh}px`;
    // Floating: the island hangs below the edge, so its top corners round off as it comes down.
    const top = Math.max(0, this.top.value);
    const hang = this.look.uiFloatGap > 0 ? Math.min(1, top / this.look.uiFloatGap) : 0;
    const tr = Math.round(r * hang);
    this.islandEl.style.top = `${top}px`;
    this.islandEl.style.borderRadius = `${tr}px ${tr}px ${r}px ${r}px`;
    this.islandEl.classList.toggle("floating", top > 0.5);
    this.islandEl.style.transform = `translateX(calc(-50% + ${this.islandLeft(w) - (this.panel.w - w) / 2}px))`;
    // These follow the island as it resizes, so they belong here rather than in
    // the state-driven DOM sync.
    const c = this.compact();
    this.sizeCompactParts(c);
    this.miniGrid.style.left = `${w - c.inset - c.gridW / 2}px`;
    this.miniGrid.style.top = `${hh / 2 - c.gridH / 2}px`;
    this.capsuleText.style.top = `${hh / 2 - this.clockH / 2}px`;
    this.greetingCanvas.style.left = `${(w - GREETING_W) / 2}px`;

    const rect = { x: this.islandLeft(w), y: top, w, h: hh };
    const p = this.pushedRect;
    if (Math.abs(p.x - rect.x) > 0.5 || Math.abs(p.y - rect.y) > 0.5 || Math.abs(p.w - rect.w) > 0.5 || Math.abs(p.h - rect.h) > 0.5) {
      this.pushedRect = rect;
      void Bridge.setIslandRect(rect.x, rect.y, rect.w, rect.h);
    }
  }

  /** Island rect in window coordinates (origin top-left of the 720×320 window). */
  private islandRect(): { x: number; y: number; w: number; h: number } {
    const shown = this.drawnSize(this.width.value, this.height.value);
    const w = shown.w;
    const hh = shown.h;
    return { x: this.islandLeft(w), y: Math.max(0, this.top.value), w, h: hh };
  }

  /** The island's left edge in window coordinates: centred, or held to one side while a width slider is dragged. */
  private islandLeft(w: number): number {
    const centred = (this.panel.w - w) / 2;
    let shift = this.shiftX.value;
    if (this.anchor) shift = this.anchor.rtl ? (w - this.anchor.w0) / 2 : (this.anchor.w0 - w) / 2;
    return Math.min(Math.max(centred + shift, 0), Math.max(0, this.panel.w - w));
  }

  /** The slider was let go: the island eases from where it hangs back to the centre. */
  private releaseAnchor() {
    if (!this.anchor) return;
    const w = this.drawnSize(this.width.value, this.height.value).w;
    const shift = this.islandLeft(w) - (this.panel.w - w) / 2;
    this.anchor = null;
    this.shiftX.jump(shift);
    this.shiftX.curveTowards(0, 320);
    this.updatePanel();
    this.ensureRunning();
  }

  // ── Window collapse (hidden → tiny wake strip, zero polling) ────────────────

  private updateWindowCollapsed() {
    if (this.collapseTimer != null) {
      window.clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
    if (State.mode === "hidden") {
      // Let the island finish retracting, then drop the window to the wake strip:
      // from there the OS delivers no cursor events, so nothing polls at all.
      this.collapseTimer = window.setTimeout(() => {
        this.collapseTimer = null;
        if (State.mode !== "hidden") return;
        this.collapsed = true;
        void Bridge.setCollapsed(true);
      }, 420);
    } else if (this.collapsed) {
      // Grow the window back before the island animates open.
      this.collapsed = false;
      void Bridge.setCollapsed(false);
    }
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  private wireInput() {
    // The wake strip is the only thing the OS can hit while the island is hidden.
    this.wakeStrip.addEventListener("mouseenter", () => {
      Sound.resume();
      if (State.mode === "hidden") this.fsm.mouseEntered();
    });

    this.islandEl.addEventListener("mousedown", (e) => {
      Sound.resume();
      State.lastActivity = performance.now();
      // Right-click on Ari opens the wardrobe, and closes it again.
      if (e.button === 2 && this.isBotHit(e.clientX, e.clientY)) {
        this.cancelBotHover();
        this.toggleWardrobe();
        return;
      }
      if (State.mode !== "expanded") {
        this.fsm.click();
        return;
      }
      if (this.isBotHit(e.clientX, e.clientY)) {
        this.cancelBotHover();
        this.engine.slap();
      }
    });

    // No browser menu over Ari: his right-click is the wardrobe. Everywhere
    // else (the text field) the webview keeps its own menu.
    this.islandEl.addEventListener("contextmenu", (e) => {
      if (this.isBotHit(e.clientX, e.clientY)) e.preventDefault();
    });

    // A text field being edited takes the keyboard; leaving it gives it back.
    this.islandEl.addEventListener("focusin", (e) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") this.takeKeyboard();
    });
    this.islandEl.addEventListener("focusout", (e) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") void Bridge.focusWindow(false);
    });

    window.addEventListener("keydown", (e) => {
      State.lastActivity = performance.now();
      if (State.mode === "hidden") return;
      if (e.key === "Escape" && State.mode === "expanded") {
        e.preventDefault();
        this.close();
      } else if ((e.code === "KeyM" || e.key === "m" || e.key === "M") && e.ctrlKey && !e.altKey) {
        e.preventDefault();
        this.toggleCompact();
      } else if ((e.code === "Comma" || e.key === ",") && e.ctrlKey && State.mode === "expanded") {
        e.preventDefault();
        this.setView("settings");
      }
    });

    // Outside the app (plain browser) drive the cursor from DOM events so the
    // island can be inspected with `npm run dev`.
    if (!IS_TAURI) this.followPageCursor();
  }

  /**
   * Takes the cursor from the page's own mouse events instead of the backend's
   * poll. The events only fire while the pointer is over the page, so leaving
   * it is reported as a cursor far away, which is what the poll would say.
   */
  followPageCursor() {
    window.addEventListener("mousemove", (e) => this.onCursor(e.clientX, e.clientY));
    window.addEventListener("mouseout", (e) => {
      if (e.relatedTarget == null) this.onCursor(-10_000, -10_000);
    });
  }

  /** Cursor in window-logical coordinates. */
  onCursor(x: number, y: number) {
    State.mouse = { x, y };
    const rect = this.islandRect();
    State.mouseInIsland = { x: x - rect.x, y: y - rect.y };

    const inIsland =
      x >= rect.x - HIT_MARGIN && x <= rect.x + rect.w + HIT_MARGIN &&
      y >= rect.y - HIT_MARGIN && y <= rect.y + rect.h + HIT_MARGIN;

    if (inIsland && !this.wasInIsland) {
      if (this.fsm.state === "greet") this.greeting.hover();
      this.fsm.mouseEntered();
    }
    if (!inIsland && this.wasInIsland) {
      this.fsm.mouseLeft();
    }
    this.wasInIsland = inIsland;

    // Bot hover → love
    const overBot = State.mode === "expanded" && this.isBotHit(x, y);
    if (overBot && !this.botHovering) this.botHoverIn(x, y);
    if (!overBot && this.botHovering) this.cancelBotHover();
    this.botHovering = overBot;
    if (this.botHovering) {
      const d = Math.hypot(x - this.botHoverStart.x, y - this.botHoverStart.y);
      if (d > 40) {
        this.botHoverStart = { x, y };
        this.scheduleLove();
      }
    }

    this.ensureRunning();
  }

  private isBotHit(x: number, y: number): boolean {
    const rect = this.islandRect();
    const cx = rect.x + this.botCx.value;
    const cy = rect.y + this.botCy.value;
    const radius = this.botSize.value / 2;
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
  }

  private botHoverIn(x: number, y: number) {
    if (performance.now() / 1000 - this.lastLoveTime < 6) return;
    this.botHoverStart = { x, y };
    this.engine.blink();
    this.engine.tgEs = 1.08;
    Sound.play("hover");
    this.scheduleLove();
  }

  private scheduleLove() {
    if (this.botHoverTimer != null) window.clearTimeout(this.botHoverTimer);
    this.botHoverTimer = window.setTimeout(() => {
      this.botHoverTimer = null;
      if (!this.botHovering || State.botState !== "idle") return;
      if (performance.now() / 1000 - this.lastLoveTime < 6) return;
      this.lastLoveTime = performance.now() / 1000;
      this.engine.triggerEmote("love");
      Sound.play("love");
    }, 1900);
  }

  private cancelBotHover() {
    if (this.botHoverTimer != null) window.clearTimeout(this.botHoverTimer);
    this.botHoverTimer = null;
    this.engine.tgEs = 1;
  }

  /** Three slaps make Ari dizzy for a moment, then back. */
  handleDizzy() {
    State.botState = "dizzy";
    this.engine.setState("dizzy");
    Sound.play("dizzy");
    if (this.confusedRecovery != null) window.clearTimeout(this.confusedRecovery);
    this.confusedRecovery = window.setTimeout(() => {
      this.confusedRecovery = null;
      if (State.botState === "dizzy") State.botState = "idle";
      this.engine.setState(State.effectiveState);
      this.engine.triggerEmote("happy");
      State.notify();
    }, 3300);
    State.notify();
  }

  // ── Frame loop ──────────────────────────────────────────────────────────────

  ensureRunning() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (nowMs: number) => {
    const dt = Math.min(0.05, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;

    this.width.step(dt, nowMs);
    this.height.step(dt, nowMs);
    this.radius.step(dt, nowMs);
    this.top.step(dt, nowMs);
    this.shiftX.step(dt, nowMs);
    this.stepCelebration(nowMs);
    this.applyGeometry();

    if (this.dirty) {
      this.dirty = false;
      this.syncDom();
    }

    this.updateBotTargets();
    this.botCx.step(dt);
    this.botCy.step(dt);
    this.botSize.step(dt);

    const greetingActive = State.mode === "expanded" && State.view === "greeting";
    if (greetingActive) {
      const gctx = this.greetingCanvas.getContext("2d");
      if (gctx) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.greeting.draw(gctx);
      }
    } else {
      this.drawBot(dt);
    }

    tickMiniBots(dt);
    const viewAnimating = this.views.get(State.view)?.tick?.(nowMs) === true;
    this.updateCountdown(nowMs);

    // Nothing is drawn while the island is hidden, so nothing may keep the loop
    // alive either: the island must cost nothing while hidden. Geometry still
    // has to finish retracting.
    const settling =
      this.width.animating || this.height.animating || this.radius.animating || this.top.animating || this.shiftX.animating;
    const busy = State.mode === "hidden"
      ? settling
      : settling ||
        !this.botCx.settled || !this.botCy.settled || !this.botSize.settled ||
        greetingActive || this.engine.busy || viewAnimating || this.celebration != null ||
        // The auto-collapse bar is drawn from this loop; it runs only while the countdown is armed.
        (State.mode === "expanded" && !State.isPinned && this.fsm.homeCollapseDueAt != null);

    if (busy) {
      requestAnimationFrame(this.frame);
    } else {
      this.running = false;
      Sound.idle();
    }
  };

  private updateBotTargets() {
    const shown = this.drawnSize(this.width.value, this.height.value);
    const p = botPosition(
      State.mode, State.view, shown.h, isRtl(),
      this.celebrationLevelNow > 0.001 ? shown.w : this.sizeOf(State.mode, State.view).w,
    );
    // The folded island is the user's to size: Ari follows its layout.
    if (State.mode === "compact") {
      const c = this.compact();
      p.cx = c.ariCx;
      p.cy = c.ariCy;
      p.diameter = c.ariD;
    }
    // While celebrating, Ari moves to the middle of the stage and grows — from the
    // folded capsule too, where he starts small beside the clock.
    if (this.celebrationLevelNow > 0.001 && (State.mode === "expanded" || State.mode === "compact")) {
      const k = this.celebrationLevelNow;
      p.cx += (shown.w / 2 - p.cx) * k;
      p.cy += (shown.h * 0.7 - p.cy) * k;
      p.diameter = State.mode === "compact" ? p.diameter + (66 - p.diameter) * k : p.diameter * (1 + 0.55 * k);
    }
    this.botCx.target = p.cx;
    this.botCy.target = p.cy;
    this.botSize.target = p.diameter / 0.6;

    const greetingActive = State.mode === "expanded" && State.view === "greeting";
    const visible = p.opacity > 0 && !greetingActive;
    this.botCanvas.style.opacity = visible ? "1" : "0";

    if (State.mode === "expanded" && !greetingActive) {
      const d = p.diameter;
      const color = botGlowColor(State.effectiveState);
      this.botGlow.style.display = "block";
      this.botGlow.style.width = `${d * 2.2}px`;
      this.botGlow.style.height = `${d * 2.2}px`;
      this.botGlow.style.left = `${this.botCx.value - d * 1.1}px`;
      this.botGlow.style.top = `${this.botCy.value - d * 1.1}px`;
      this.botGlow.style.background = `radial-gradient(circle, ${color} 0%, transparent 62%)`;
      this.botGlow.style.opacity = String(botGlowOpacity(State.effectiveState));
    } else {
      this.botGlow.style.display = "none";
    }
  }

  private drawBot(dt: number) {
    const size = this.botSize.value;
    const w = Math.max(1, Math.round(size));
    const hCss = w + BOT_OVERHANG;
    const wCss = w + BOT_SIDE * 2;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvasPx !== w) {
      this.canvasPx = w;
      this.botCanvas.width = Math.round(wCss * dpr);
      this.botCanvas.height = Math.round(hCss * dpr);
      this.botCanvas.style.width = `${wCss}px`;
      this.botCanvas.style.height = `${hCss}px`;
    }
    this.botCanvas.style.left = `${this.botCx.value - wCss / 2}px`;
    this.botCanvas.style.top = `${this.botCy.value - BOT_OVERHANG / 2 - hCss / 2}px`;

    const ctx = this.botCanvas.getContext("2d");
    if (!ctx) return;

    this.engine.bodyColor = null;
    this.engine.particleOverhang = BOT_OVERHANG;
    this.engine.lookX = this.lookX();
    this.engine.lookY = this.lookY();
    this.engine.slotHTarget = 0;
    if (this.engine.morph < 0.05) {
      this.engine.slotH = 0;
      this.engine.slotHVel = 0;
    }
    // In the wardrobe or settings the hovered outfit swaps in at once, without the drop-in.
    const inWardrobe = State.mode === "expanded" && (State.view === "wardrobe" || State.view === "settings");
    // The Football section is Ari's own dressing room: there he wears the favourite team's kit
    // and nothing else, and everywhere else the kit stays off. The two never mix.
    const kit = State.mode === "expanded" && State.view === "football" && State.settings.footballKit ? kitForState(Football.state) : null;
    const outfit = kit ? "none" : State.wardrobePreview ?? this.seasons.get(parseOutfit(State.settings.ariOutfit));
    this.engine.setOutfit(outfit, !inWardrobe && !kit);

    const cheering = ariCheers(this.celebration, performance.now(), State.mode, State.view);
    this.engine.cheering = cheering;
    this.engine.gloomy = ariGloomy(this.celebration, performance.now(), State.mode, State.view);
    this.engine.kit = kit;
    this.engine.setDancing(cheering || islandDances({
      music: musicPlaying(Spotify.state), state: State.effectiveState, mode: State.mode, view: State.view,
    }));
    this.engine.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, BOT_SIDE * dpr, 0);
    ctx.clearRect(-BOT_SIDE, 0, wCss, hCss);
    ctx.save();
    this.engine.applyDance(ctx, w, hCss);
    this.engine.draw(ctx, w, hCss);
    ctx.restore();
  }

  /** tanh of the distance to the bot, so the eyes follow the cursor. */
  private lookX(): number {
    const rect = this.islandRect();
    const botScreenX = rect.x + this.botCx.value;
    return Math.tanh((State.mouse.x - botScreenX) / 260);
  }

  private lookY(): number {
    return -Math.tanh((State.mouse.y - this.botCy.value) / 200);
  }

  private updateCountdown(nowMs: number) {
    // The state machine's own deadline, so the bar follows an auto-close delay
    // edited while the countdown runs.
    const dueAt = this.fsm.homeCollapseDueAt;
    if (State.mode !== "expanded" || State.isPinned || dueAt == null) {
      this.countdown.style.width = "0px";
      return;
    }
    const autoClose = this.fsm.homeToPetitDelay;
    const windowS = Math.min(10, autoClose * 0.6);
    const remaining = (dueAt - nowMs) / 1000;
    this.countdown.style.width =
      remaining < windowS ? `${Math.max(0, clamp(remaining / windowS, 0, 1) * 160)}px` : "0px";
  }

  // ── DOM sync ────────────────────────────────────────────────────────────────

  private syncDom() {
    const expanded = State.mode === "expanded";
    const greetingActive = expanded && State.view === "greeting";

    const live = expanded && !greetingActive;
    // While a goal is celebrated the page behind it fades to a hint, so the banner reads.
    this.contentEl.style.opacity = live ? String(1 - 0.9 * this.celebrationLevelNow) : "0";
    this.contentEl.style.pointerEvents = live ? "auto" : "none";
    this.header.el.style.pointerEvents = live ? "auto" : "none";
    this.greetingCanvas.style.display = greetingActive ? "block" : "none";
    // The intro is a night scene: the island is black for it, in either theme.
    this.islandEl.classList.toggle("stage", greetingActive);
    this.islandEl.classList.toggle("open", expanded);

    // Leaving the greeting, however it ends, lets its sound fade out.
    if (this.greetingShown && !greetingActive) this.greeting.leave();
    this.greetingShown = greetingActive;
    // A wardrobe try-on never outlives the wardrobe.
    if (State.wardrobePreview && !(expanded && State.view === "wardrobe")) State.wardrobePreview = null;

    this.header.sync();
    for (const [name, view] of this.views) {
      const on = name === State.view;
      view.el.classList.toggle("on", on);
      if (on) view.sync();
    }

    // The backend reads prices only while the crypto section is on screen.
    const cryptoOnScreen = expanded && State.view === "crypto";
    if (cryptoOnScreen !== this.cryptoReported) {
      this.cryptoReported = cryptoOnScreen;
      void Bridge.cryptoActive(cryptoOnScreen);
    }

    // The translate and history views have a text field: while one is up the
    // island may take keyboard focus (the field itself asks, on focus).
    if (this.lastSyncedView !== State.view) {
      this.lastSyncedView = State.view;
      if (State.view === "translate" || State.view === "spotify" || State.view === "football") {
        window.setTimeout(() => {
          if (State.view === this.lastSyncedView) this.views.get(State.view)?.focus?.();
        }, 120);
      } else {
        void Bridge.focusWindow(false);
      }
    }

    // The compact grid keeps the engine minis and adds Spotify while enabled.
    const tasks: MiniTask[] = [...State.tasks];
    if (State.settings.spotifyEnabled) {
      tasks.push({ id: SPOTIFY_ID, name: "Spotify", color: SPOTIFY_GREEN, state: "idle" });
    }
    if (State.settings.footballEnabled && State.settings.footballTeamId) {
      tasks.push({ id: FOOTBALL_ID, name: "Football", color: FOOTBALL_COLOR, state: "idle" });
    }
    // The capsule's minis and clock step aside while a show fills the island.
    const showGrid = State.mode === "compact" && this.celebrationLevelNow < 0.001 && this.celebration == null;
    this.miniGrid.style.opacity = showGrid ? "1" : "0";
    this.capsuleText.style.opacity = showGrid ? "1" : "0";
    if (showGrid) {
      this.miniRows = Math.max(2, Math.ceil(tasks.length / 2));
      const c = this.compact();
      const key = tasks.map((x) => `${x.id}:${x.color}`).join("|") + `@${c.k.toFixed(2)}`;
      if (this.miniGrid.dataset.key !== key) {
        this.miniGrid.dataset.key = key;
        this.miniGrid.replaceChildren();
        for (const task of tasks) {
          this.miniGrid.append(createMiniBot(task, 13 * c.k,
            task.id === SPOTIFY_ID ? () => musicPlaying(Spotify.state) : undefined));
        }
        pruneMiniBots();
      }
      this.paintClock();
      this.scheduleClock();
    }

    syncMiniBotStates(tasks);
    this.engine.setState(State.effectiveState);
  }

  // ── Compact clock ───────────────────────────────────────────────────────────

  private clockTimer: number | null = null;

  /** The time, in the interface language's digits (۱۴:۳۰ in Persian). */
  private paintClock() {
    const locale = language() === "fa" ? "fa-IR" : "en-GB";
    this.capsuleText.textContent = new Intl.DateTimeFormat(locale, {
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date());
  }

  /**
   * One timer, on the minute, and only while the capsule is showing: the island
   * costs nothing when it is folded away or open on another view.
   */
  private scheduleClock() {
    if (this.clockTimer != null) return;
    const delay = 60_000 - (Date.now() % 60_000) + 40;
    this.clockTimer = window.setTimeout(() => {
      this.clockTimer = null;
      if (State.mode !== "compact") return;
      this.paintClock();
      this.scheduleClock();
    }, delay);
  }

  /** Applies settings coming from the backend at boot and on every change. */
  applySettings() {
    Sound.setEnabled(State.settings.soundEnabled);
    Sound.setVolume(State.settings.soundVolume);
    this.fsm.homeToPetitDelay = State.settings.autoCloseInterval;
    this.applyLook();
    State.notify();
  }

  // ── Look: size, transparency, text size, corners (Settings → Island look) ──────

  /** The look now: the saved one, with whatever a slider being dragged shows on top. */
  private currentLook(): Look {
    return lookOf({ ...State.settings, ...State.lookPreview });
  }

  /** The island's size for a mode and view, with the look applied (open views only; the capsule and the intro keep theirs). */
  private sizeOf(mode: IslandMode, view: IslandViewName): { w: number; h: number } {
    const base = islandSize(mode, view, State.translateH, State.translateW);
    if (mode === "compact") return compactSize(this.look);
    if (mode !== "expanded" || view === "greeting") return base;
    return scaledIsland(base, view === "translate", this.look, this.screenLimit(), view === "translate" ? State.translateNeedH : 0);
  }

  /** The most the island may take: the screen it is on, less a margin. */
  private screenLimit(): { w: number; h: number } {
    const s = typeof window !== "undefined" ? window.screen : undefined;
    return { w: Math.max(PANEL_W, (s?.width ?? 1920) - 24), h: Math.max(PANEL_H, (s?.height ?? 1080) - 48) };
  }

  /** The folded capsule at the current look: its box, and where and how big Ari, the clock and the minis are. */
  private compact(): CompactLayout {
    return compactLayout(this.look, this.miniRows);
  }

  /** The capsule's clock and mini grid at the capsule's zoom (only when it changes: this runs every frame). */
  private sizeCompactParts(c: CompactLayout) {
    const fs = this.look.uiFontScale / 100;
    const key = `${c.k.toFixed(3)}|${this.miniRows}|${fs}`;
    if (key === this.compactStyleKey) return;
    this.compactStyleKey = key;
    const mini = 13 * c.k;
    const g = this.miniGrid.style;
    g.width = `${c.gridW}px`;
    g.height = `${c.gridH}px`;
    g.gridTemplateColumns = `${mini}px ${mini}px`;
    g.gridAutoRows = `${mini}px`;
    g.gap = `${3 * c.k}px`;
    this.clockH = 16 * c.k * fs;
    const t = this.capsuleText.style;
    t.fontSize = `${12.5 * c.k * fs}px`;
    t.lineHeight = `${this.clockH}px`;
    t.height = `${this.clockH}px`;
  }

  /** Applies a changed look at once: the text scale and surfaces through CSS, the size through the island's springs. */
  applyLook() {
    const look = this.currentLook();
    const key = JSON.stringify(look);
    if (key === this.lookKey) return;
    const before = this.sizeOf(State.mode, State.view);
    this.lookKey = key;
    this.look = look;
    applyLookVars(document.documentElement, look);
    this.updatePanel();
    // The cards are measured again at the new text size, so the translator is exactly as tall as they need.
    this.translate.refit();
    const after = this.sizeOf(State.mode, State.view);
    this.animateGeometry(after.w < before.w || after.h < before.h);
    this.dirty = true;
    this.ensureRunning();
  }

  /**
   * The window grows before the island does and shrinks after it has shrunk, so the island is
   * never cut off by its own window. At the default look it is exactly the default panel.
   */
  private updatePanel() {
    // While a width slider is dragged the window is opened once for the widest island and left alone: resizing it
    // on every step moves the island under the pointer (the window is centred, and its size and place change in turn).
    const forPanel = this.anchor ? { ...this.look, uiWidth: LOOK.uiWidth.max } : this.look;
    const wanted = panelFor(forPanel, { w: PANEL_W, h: PANEL_H }, LARGEST, SHADOW_ROOM, this.screenLimit());
    if (this.anchor) {
      // One edge stays where it was and the island grows from the other: it must be able to reach its widest
      // without that edge meeting the window's (the window is centred, so the room needed is 2 x widest - start).
      const widest = wanted.w - SHADOW_ROOM * 2;
      wanted.w = Math.max(wanted.w, Math.ceil((2 * widest - this.anchor.w0 + SHADOW_ROOM * 2) / PANEL_STEP) * PANEL_STEP);
    }
    if (this.panelTimer != null) {
      window.clearTimeout(this.panelTimer);
      this.panelTimer = null;
    }
    if (wanted.w === this.panel.w && wanted.h === this.panel.h) return;
    const apply = () => {
      this.panelTimer = null;
      this.panel = wanted;
      this.pushedRect = { x: -1, y: -1, w: -1, h: -1 };
      void Bridge.setPanelSize(wanted.w, wanted.h);
      this.dirty = true;
      this.ensureRunning();
    };
    if (wanted.w >= this.panel.w && wanted.h >= this.panel.h) apply();
    else this.panelTimer = window.setTimeout(apply, PANEL_SHRINK_DELAY_MS);
  }

  get panelSize() {
    return { ...this.panel };
  }
}
