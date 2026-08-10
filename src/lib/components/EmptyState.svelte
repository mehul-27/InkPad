<script lang="ts">
  import { openDocument } from "../actions";
</script>

<section class="empty-state">
  <img class="logo" src="/inkpad-mark.png" alt="InkPad" width="44" height="44" />
  <h1 class="title">InkPad</h1>
  <p class="tagline">
    Your Markdown, without<br />
    the development environment.
  </p>

  <p class="drop-hint">Drop a file here</p>
  <p class="or">or</p>
  <button class="open-btn" type="button" onclick={openDocument}>Open File</button>
</section>

<style>
  .empty-state {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0;
    text-align: center;
    padding-bottom: 40px;
  }

  .title {
    margin: 14px 0 10px;
    font-size: 28px;
    font-weight: 650;
    letter-spacing: 0.01em;
    color: var(--foreground);
  }

  .logo {
    display: block;
    opacity: 0.9;
  }

  .tagline {
    margin: 0 0 44px;
    font-size: 15px;
    line-height: 1.6;
    color: var(--muted-foreground);
  }

  .drop-hint {
    margin: 0;
    font-size: 13px;
    color: var(--muted-foreground);
  }

  .or {
    margin: 10px 0;
    font-size: 12px;
    color: var(--muted-foreground);
  }

  .open-btn {
    padding: 7px 20px;
    border-radius: 7px;
    font-size: 13px;
    font-weight: 500;
    color: var(--accent-foreground);
    background: var(--accent);
  }

  .open-btn:hover {
    opacity: 0.92;
  }
</style>
