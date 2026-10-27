// Island open/close state machine.
// No DOM, no Tauri: it only reports transitions.

export type FsmState = "hidden" | "petit" | "home" | "greet";

export class IslandStateMachine {
  state: FsmState = "hidden";

  onTransition: ((from: FsmState, to: FsmState) => void) | null = null;

  /**
   * home → petit delay, seconds: the auto-close preference. Changing it while a
   * countdown runs starts that countdown again with the new delay, so an edit in
   * Settings applies at once.
   */
  get homeToPetitDelay(): number {
    return this.homeDelay;
  }
  set homeToPetitDelay(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds === this.homeDelay) return;
    this.homeDelay = seconds;
    if (this.state === "home" && this.homeCollapse != null) this.scheduleHomeCollapse();
  }
  /**
   * petit → hidden delay, seconds. Only a compact island that came up out of hiding (a hover on
   * the strip, an event) goes back after it; one that was folded from the open island stays.
   */
  petitToHiddenDelay = 60;
  /** greet → petit once the greeting animation ends (no hover). */
  greetAutoCollapseDelay = 0.6;
  /** greet → petit while the mouse hovers the greeting. */
  greetHoverCollapseDelay = 10;
  /** An alert waiting for an answer stays open, even when the mouse leaves. */
  pinned = false;
  /**
   * A view that is a whole web app (Muse) stays open when the mouse leaves: only a click
   * outside folds it. Unlike `pinned`, the compact island is not held on screen by it.
   */
  get stayOpen(): boolean {
    return this.holdOpen;
  }
  set stayOpen(on: boolean) {
    this.holdOpen = on;
    if (on) this.clear("homeCollapse");
  }
  private holdOpen = false;

  /**
   * When the open island will fold, on the performance.now() clock, while the
   * mouse-leave countdown runs; null otherwise. The island draws its countdown
   * bar from it.
   */
  homeCollapseDueAt: number | null = null;

  /** The compact island is only a visit from hiding: it goes back to hiding. Otherwise it stays. */
  private peeking = false;
  /** A show fills the compact island: it must not hide until the show is over. */
  private holding = false;
  private homeDelay = 15;
  private petitHide: number | null = null;
  private homeCollapse: number | null = null;
  private greetCollapse: number | null = null;

  // ── Inputs ──────────────────────────────────────────────────────────────────

  launch() {
    this.cancelTimers();
    this.peeking = false;
    this.transition("greet");
  }

  mouseEntered() {
    switch (this.state) {
      case "hidden":
        this.cancelTimers();
        this.peeking = true;
        this.transition("petit");
        break;
      case "petit":
        this.clear("petitHide");
        break;
      case "home":
        this.clear("homeCollapse");
        break;
      case "greet":
        this.scheduleGreetCollapse(this.greetHoverCollapseDelay);
        break;
    }
  }

  mouseLeft() {
    switch (this.state) {
      case "hidden":
        break;
      case "petit":
        this.schedulePetitHide();
        break;
      case "home":
        this.scheduleHomeCollapse();
        break;
      case "greet":
        this.clear("greetCollapse");
        this.transition("petit");
        break;
    }
  }

  click() {
    if (this.state !== "petit") return;
    this.cancelTimers();
    this.peeking = false;
    this.transition("home");
  }

  /** Greeting animation finished (T.end). Doesn't override a running hover timer. */
  greetComplete() {
    if (this.state !== "greet") return;
    if (this.greetCollapse == null) this.scheduleGreetCollapse(this.greetAutoCollapseDelay);
  }

  /** Non-alert work event: show compact from hidden. */
  reveal() {
    if (this.state !== "hidden") return;
    this.cancelTimers();
    this.peeking = true;
    this.transition("petit");
    this.schedulePetitHide();
  }

  /**
   * A show fills the island: the compact island stays up (its hide timer is stopped)
   * until `releasePetit`, so it cannot fold away under the show.
   */
  holdPetit() {
    this.holding = true;
    this.clear("petitHide");
  }

  /** The show is over: the compact island hides again after its usual delay. */
  releasePetit() {
    if (!this.holding) return;
    this.holding = false;
    if (this.state === "petit") this.schedulePetitHide();
  }

  /** Alert or explicit request: open straight to expanded. */
  forceHome() {
    this.cancelTimers();
    this.peeking = false;
    this.transition("home");
  }

  /// Explicit close (OK button, Escape, an alert being answered).
  forcePetit() {
    this.cancelTimers();
    this.peeking = false;
    this.transition("petit");
  }

  forceHidden() {
    this.cancelTimers();
    this.peeking = false;
    this.transition("hidden");
  }

  // ── Timers ──────────────────────────────────────────────────────────────────

  private schedulePetitHide() {
    this.clear("petitHide");
    // A card folded away while it waits for an answer keeps the compact island
    // on screen, so it can be reopened (isHeldOpen ).
    if (this.pinned || !this.peeking) return;
    this.petitHide = window.setTimeout(() => {
      this.petitHide = null;
      if (this.state === "petit" && !this.pinned && !this.holding) this.transition("hidden");
    }, this.petitToHiddenDelay * 1000);
  }

  private scheduleHomeCollapse() {
    this.clear("homeCollapse");
    if (this.pinned || this.stayOpen) return;
    const ms = this.homeDelay * 1000;
    this.homeCollapseDueAt = performance.now() + ms;
    this.homeCollapse = window.setTimeout(() => {
      this.homeCollapse = null;
      this.homeCollapseDueAt = null;
      // An alert pinned while the countdown ran keeps the island open.
      if (this.state === "home" && !this.pinned) this.transition("petit");
    }, ms);
  }

  private scheduleGreetCollapse(delay: number) {
    this.clear("greetCollapse");
    this.greetCollapse = window.setTimeout(() => {
      this.greetCollapse = null;
      if (this.state === "greet") this.transition("petit");
    }, delay * 1000);
  }

  private clear(which: "petitHide" | "homeCollapse" | "greetCollapse") {
    const id = this[which];
    if (id != null) window.clearTimeout(id);
    this[which] = null;
    if (which === "homeCollapse") this.homeCollapseDueAt = null;
  }

  cancelTimers() {
    this.clear("petitHide");
    this.clear("homeCollapse");
    this.clear("greetCollapse");
  }

  private transition(next: FsmState) {
    if (next === this.state) return;
    const from = this.state;
    this.state = next;
    this.onTransition?.(from, next);
  }
}
