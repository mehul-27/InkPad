<script lang="ts">
  // Phase 6: Settings. Deliberately small — every control here has a real
  // effect, applied live (no restart). Persistence lives in the settings
  // store (localStorage); the theme lives in its own store but is surfaced
  // here as the first Appearance control.

  import Overlay from "./Overlay.svelte";
  import { settings, updateSettings } from "../settings";
  import { theme } from "../stores";
  import type { Settings as SettingsShape } from "../settings";
  import type { Theme } from "../stores";

  interface Option<T> {
    value: T;
    label: string;
  }

  const themeOptions: Option<Theme>[] = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
    { value: "system", label: "System" },
  ];
  const widthOptions: Option<SettingsShape["contentWidth"]>[] = [
    { value: "comfortable", label: "Comfortable" },
    { value: "wide", label: "Wide" },
  ];
  const fontOptions: Option<SettingsShape["readerFontSize"]>[] = [
    { value: "small", label: "Small" },
    { value: "default", label: "Default" },
    { value: "large", label: "Large" },
  ];
  const onOffOptions: Option<boolean>[] = [
    { value: true, label: "On" },
    { value: false, label: "Off" },
  ];
</script>

<Overlay width={460}>
  <div class="settings">
    <h2 class="title">Settings</h2>

    <div class="section">Appearance</div>
    <div class="row">
      <span class="label">Theme</span>
      <div class="segmented">
        {#each themeOptions as option}
          <button
            type="button"
            class:active={$theme === option.value}
            onclick={() => theme.set(option.value)}
          >{option.label}</button>
        {/each}
      </div>
    </div>

    <div class="section">Reading</div>
    <div class="row">
      <span class="label">Content width</span>
      <div class="segmented">
        {#each widthOptions as option}
          <button
            type="button"
            class:active={$settings.contentWidth === option.value}
            onclick={() => updateSettings({ contentWidth: option.value })}
          >{option.label}</button>
        {/each}
      </div>
    </div>
    <div class="row">
      <span class="label">Reader font size</span>
      <div class="segmented">
        {#each fontOptions as option}
          <button
            type="button"
            class:active={$settings.readerFontSize === option.value}
            onclick={() => updateSettings({ readerFontSize: option.value })}
          >{option.label}</button>
        {/each}
      </div>
    </div>

    <div class="section">Editor</div>
    <div class="row">
      <span class="label">Font size</span>
      <div class="segmented">
        {#each fontOptions as option}
          <button
            type="button"
            class:active={$settings.editorFontSize === option.value}
            onclick={() => updateSettings({ editorFontSize: option.value })}
          >{option.label}</button>
        {/each}
      </div>
    </div>
    <div class="row">
      <span class="label">Word wrap</span>
      <div class="segmented">
        {#each onOffOptions as option}
          <button
            type="button"
            class:active={$settings.wordWrap === option.value}
            onclick={() => updateSettings({ wordWrap: option.value })}
          >{option.label}</button>
        {/each}
      </div>
    </div>

    <div class="section">Behavior</div>
    <div class="row">
      <span class="label">Autosave</span>
      <div class="segmented">
        {#each onOffOptions as option}
          <button
            type="button"
            class:active={$settings.autosave === option.value}
            onclick={() => updateSettings({ autosave: option.value })}
          >{option.label}</button>
        {/each}
      </div>
    </div>

    <p class="hint">Changes apply immediately and are saved automatically.</p>
  </div>
</Overlay>

<style>
  .settings {
    padding: 4px 20px 18px;
    max-height: calc(100vh - 140px);
    overflow-y: auto;
  }

  .title {
    margin: 12px 0 2px;
    font-size: 15px;
    font-weight: 650;
    color: var(--foreground);
  }

  .section {
    margin: 16px 0 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 7px 0;
    border-bottom: 1px solid var(--hairline);
  }

  .label {
    font-size: 13px;
    color: var(--foreground);
  }

  .segmented {
    display: flex;
    padding: 2px;
    border-radius: 7px;
    background: var(--surface);
    border: 1px solid var(--hairline);
  }

  .segmented button {
    padding: 3px 11px;
    border-radius: 5px;
    font-size: 12px;
    color: var(--muted-foreground);
  }

  .segmented button:hover {
    color: var(--foreground);
  }

  .segmented button.active {
    background: var(--surface-raised);
    color: var(--foreground);
    font-weight: 500;
  }

  .hint {
    margin: 14px 0 4px;
    font-size: 11.5px;
    color: var(--muted-foreground);
  }
</style>