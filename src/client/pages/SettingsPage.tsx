import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { AdministrationSettings, ControllerPresetKey, EmulatorProfile } from "../../domain/types";
import { api } from "../api";
import { PortalHeader } from "../components";
import { usePlayerProfile } from "../player-profile";
import { themeChoices, useTheme } from "../theme";

interface ControllerChoice {
  key: ControllerPresetKey;
  name: string;
  description: string;
  mapping: string;
}

const controllerChoices: ControllerChoice[] = [
  { key: "keyboard", name: "Keyboard", description: "Best when playing on a computer.", mapping: "Arrows · Z/X = A/B · A/S = Y/X · Q/W = L/R" },
  { key: "joy-con", name: "Joy-Con", description: "For paired or browser-recognized Switch controllers.", mapping: "D-pad · face buttons · shoulder buttons · +/−" },
  { key: "switch-pro", name: "Pro Controller", description: "For a Nintendo Switch Pro-style controller.", mapping: "D-pad · face buttons · shoulder buttons · +/−" },
  { key: "apple-tv-remote", name: "Apple TV Remote", description: "For keyboard-like remote input in a compatible WebView.", mapping: "Directional pad · Click = A · Play/Pause = Start" },
];

export function SettingsPage(): React.JSX.Element {
  const { theme, accent, setTheme, setAccent } = useTheme();
  const { activeProfile, setControllerPreset } = usePlayerProfile();
  const [controllerStatus, setControllerStatus] = useState("");
  const [savingController, setSavingController] = useState<ControllerPresetKey | null>(null);
  const [administration, setAdministration] = useState<AdministrationSettings | null>(null);
  const [libraryPath, setLibraryPath] = useState("");
  const [administrationStatus, setAdministrationStatus] = useState("");
  const [administrationStatusKind, setAdministrationStatusKind] = useState<"success" | "error">("success");
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const updateAccent = (value: string) => setAccent(value);
  useEffect(() => {
    if (!activeProfile?.isAdministrator) {
      setAdministration(null);
      return;
    }
    void api.administrationSettings()
      .then((settings) => {
        setAdministration(settings);
        setLibraryPath(settings.library.rootPath);
      })
      .catch((error: unknown) => {
        setAdministrationStatusKind("error");
        setAdministrationStatus(error instanceof Error ? error.message : "Administration settings could not be loaded.");
      });
  }, [activeProfile?.key, activeProfile?.isAdministrator]);
  const chooseController = async (controllerPreset: ControllerPresetKey) => {
    setSavingController(controllerPreset);
    setControllerStatus("");
    try {
      await setControllerPreset(controllerPreset);
      setControllerStatus("Controller preference saved. It will be applied when you next launch a game.");
    } catch (error) {
      setControllerStatus(error instanceof Error ? error.message : "Controller preference could not be saved.");
    } finally {
      setSavingController(null);
    }
  };
  const checkControllers = () => {
    if (!("getGamepads" in navigator)) {
      setControllerStatus("This browser does not expose connected game controllers.");
      return;
    }
    const connected = [...navigator.getGamepads()].filter((gamepad): gamepad is Gamepad => Boolean(gamepad?.connected));
    setControllerStatus(connected.length
      ? `${connected.length} connected controller${connected.length === 1 ? "" : "s"}: ${connected.map((gamepad) => gamepad.id).join(", ")}`
      : "No controller is visible yet. Connect it, press a button, then check again.");
  };
  const saveLibraryLocation = async (event: FormEvent) => {
    event.preventDefault();
    setSavingLibrary(true);
    setAdministrationStatus("");
    try {
      const { library } = await api.updateLibraryRoot(libraryPath);
      setAdministration((current) => current ? { ...current, library } : current);
      setLibraryPath(library.rootPath);
      setAdministrationStatusKind("success");
      setAdministrationStatus("ROM Library location saved. Scan the library to refresh the catalog.");
    } catch (error) {
      setAdministrationStatusKind("error");
      setAdministrationStatus(error instanceof Error ? error.message : "ROM Library location could not be saved.");
    } finally {
      setSavingLibrary(false);
    }
  };
  const rescanLibrary = async () => {
    setRescanning(true);
    setAdministrationStatus("");
    try {
      const result = await api.rescan();
      const refreshed = await api.administrationSettings();
      setAdministration(refreshed);
      setAdministrationStatusKind("success");
      const catalogMessage = result.added > 0
        ? `${result.added} new ${result.added === 1 ? "file" : "files"} added.`
        : `${result.discovered} ${result.discovered === 1 ? "file" : "files"} discovered.`;
      setAdministrationStatus(`Scan complete. ${catalogMessage} Metadata matched for ${result.metadataMatched} ${result.metadataMatched === 1 ? "title" : "titles"}.`);
    } catch (error) {
      setAdministrationStatusKind("error");
      setAdministrationStatus(error instanceof Error ? error.message : "The ROM Library could not be scanned.");
    } finally {
      setRescanning(false);
    }
  };
  return (
    <main className="stream-shell settings-page">
      <PortalHeader />
      <section className="settings-heading"><p className="stream-kicker">Portal preferences</p><h1>Settings</h1><p>Choose how the Portal looks, how controls behave, and—when using the Household administrator profile—how the server catalogs and plays your library.</p></section>
      <section className="settings-panel" aria-labelledby="theme-heading">
        <div className="settings-section-title"><div><p>Appearance</p><h2 id="theme-heading">Theme</h2></div><span>Saved for {activeProfile?.displayName ?? "this profile"}</span></div>
        <div className="theme-grid">{themeChoices.map((choice) => <button key={choice.key} type="button" className={`theme-card${theme === choice.key ? " selected" : ""}`} onClick={() => setTheme(choice.key)} aria-pressed={theme === choice.key} data-controller-target><span className="theme-preview" data-preview-theme={choice.key}>{choice.swatches.map((color) => <i key={color} style={{ background: color }} />)}</span><strong>{choice.name}</strong><small>{choice.description}</small><b>{theme === choice.key ? "✓ Selected" : "Choose theme"}</b></button>)}</div>
        <div className={`accent-setting${theme === "current" ? "" : " disabled"}`}><div><h3>Portal accent</h3><p>Choose the main color used for focus rings, badges, and highlights in the current Portal theme.</p></div><label><input type="color" value={accent} onInput={(event) => updateAccent(event.currentTarget.value)} onChange={(event) => updateAccent(event.currentTarget.value)} aria-label="Portal accent color" /><span>{accent.toLocaleUpperCase("en-US")}</span></label></div>
      </section>
      <section className="settings-panel controller-settings" aria-labelledby="controller-heading">
        <div className="settings-section-title"><div><p>Player controls</p><h2 id="controller-heading">Controller</h2></div><span>Applied on the next game launch</span></div>
        <div className="controller-choice-grid">{controllerChoices.map((choice) => {
          const selected = (activeProfile?.controllerPreset ?? "keyboard") === choice.key;
          return <button key={choice.key} type="button" className={`controller-choice${selected ? " selected" : ""}`} onClick={() => void chooseController(choice.key)} disabled={savingController !== null} aria-pressed={selected} data-controller-target>
            <ControllerIllustration controller={choice.key} />
            <span className="controller-choice-copy"><strong>{choice.name}</strong><small>{choice.description}</small><em>{choice.mapping}</em><b>{savingController === choice.key ? "Saving…" : selected ? "✓ Selected" : "Use this controller"}</b></span>
          </button>;
        })}</div>
        <div className="controller-check"><div><h3>Connected controller check</h3><p>Browsers reveal controllers only after they are connected and a button is pressed. If the buttons differ, use the player’s Control Settings screen to remap that device.</p></div><button type="button" className="stream-button secondary" onClick={checkControllers} data-controller-target>Check controllers</button></div>
        <p className="controller-compatibility"><b>Apple TV Remote compatibility:</b> this preset works only in a browser or TV WebView that exposes remote presses as keyboard-like input. A regular Safari page cannot turn the remote into a web gamepad.</p>
        <p className="settings-message" role="status" aria-live="polite">{controllerStatus}</p>
      </section>
      {activeProfile?.isAdministrator && <>
        <section className="settings-panel library-settings" id="library" aria-labelledby="library-heading">
          <div className="settings-section-title"><div><p>Server library</p><h2 id="library-heading">Library</h2></div><span>Read-only discovery</span></div>
          {administration ? <>
            <form className="library-location-form" onSubmit={(event) => void saveLibraryLocation(event)}>
              <label htmlFor="rom-library-path"><span>ROM Library location</span><input id="rom-library-path" type="text" value={libraryPath} onChange={(event) => setLibraryPath(event.target.value)} placeholder="/roms" autoComplete="off" spellCheck={false} required data-controller-target /></label>
              <button className="stream-button primary" type="submit" disabled={savingLibrary || rescanning} data-controller-target>{savingLibrary ? "Saving…" : "Save location"}</button>
            </form>
            <div className={`library-health ${administration.library.available ? "available" : "unavailable"}`}><span aria-hidden="true">{administration.library.available ? "✓" : "!"}</span><div><strong>{administration.library.available ? "Library available" : "Library unavailable"}</strong><p>{administration.library.statusMessage}</p></div></div>
            <div className="library-scan-row"><div><h3>Catalog scan</h3><p>Reads `.nes`, `.sfc`, `.smc`, and `.snes` files beneath this directory and updates the Catalog. Source Game Files are never renamed, modified, or deleted.</p><small>{administration.library.lastScannedAt ? `Last scanned ${formatSettingsDate(administration.library.lastScannedAt)}` : "Not scanned yet"}</small></div><button className="stream-button secondary" type="button" onClick={() => void rescanLibrary()} disabled={rescanning || savingLibrary || !administration.library.available} data-controller-target>{rescanning ? "Scanning…" : "↻ Rescan library"}</button></div>
          </> : <p className="settings-loading">Loading Library configuration…</p>}
          <p className={`administration-message ${administrationStatusKind}`} role="status" aria-live="polite">{administrationStatus}</p>
        </section>
        <section className="settings-panel administration-settings" id="administration" aria-labelledby="administration-heading">
          <div className="settings-section-title"><div><p>Server administration</p><h2 id="administration-heading">Administration</h2></div><span>Household administrator</span></div>
          <div className="administration-grid">
            <article className="administration-card presentation-management-card"><div className="administration-card-icon" aria-hidden="true">▤</div><div><p>Browse</p><h3>Browse & Collections</h3><span>Create reusable Collections and choose which editable shelves appear on the Browse screen.</span></div><Link className="stream-button secondary" to="/admin/presentation" data-controller-target>Open Browse Management →</Link></article>
            <article className="administration-card metadata-management-card"><div className="administration-card-icon" aria-hidden="true">Aa</div><div><p>Catalog</p><h3>Metadata Management</h3><span>Review and correct Metadata Matches. Corrections survive rescans, and artwork remains cached on the server.</span></div><Link className="stream-button secondary" to="/admin/metadata" data-controller-target>Open Metadata Management →</Link></article>
            <section className="emulator-settings" aria-labelledby="emulators-heading"><div className="emulator-heading"><div><p>Playback policy</p><h3 id="emulators-heading">Emulators</h3></div><span>Configured once per Platform</span></div>{administration ? <div className="emulator-profile-grid">{administration.emulators.map((profile) => <EmulatorProfileCard key={profile.platform.key} profile={profile} />)}</div> : <p className="settings-loading">Loading Emulator Profiles…</p>}<p className="native-client-note"><b>Future-client ready:</b> Platform identity and compatibility are server-owned. The web configuration shown here is used only by the browser Playback Adapter; a future Apple TV client can provide its own compatible native emulator implementation.</p></section>
          </div>
        </section>
      </>}
    </main>
  );
}

function EmulatorProfileCard({ profile }: { profile: EmulatorProfile }): React.JSX.Element {
  return <article className={`emulator-profile-card${profile.enabled ? " enabled" : " disabled"}`}>
    <div className="platform-device" data-platform={profile.platform.key} aria-hidden="true"><i /><i /><i /></div>
    <div><span className="emulator-status">{profile.enabled ? "Enabled" : "Not enabled"}</span><h4>{profile.platform.displayName}</h4><p>Policy · Automatic Platform default</p>{profile.webPlayback ? <dl><div><dt>Web adapter</dt><dd>{displayRuntimeName(profile.webPlayback.adapterKey)}</dd></div><div><dt>Web core</dt><dd>{displayRuntimeName(profile.webPlayback.coreKey)}</dd></div></dl> : <small>No web playback implementation configured.</small>}</div>
  </article>;
}

function displayRuntimeName(value: string): string {
  if (value === "emulatorjs") return "EmulatorJS";
  if (value === "fceumm") return "FCEUmm";
  if (value === "snes9x") return "Snes9x";
  return value;
}

function formatSettingsDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function ControllerIllustration({ controller }: { controller: ControllerPresetKey }): React.JSX.Element {
  if (controller === "keyboard") return <svg className="controller-illustration" viewBox="0 0 240 120" aria-hidden="true"><rect className="controller-body" x="22" y="27" width="196" height="66" rx="12"/><g className="controller-button"><rect x="39" y="41" width="18" height="14" rx="3"/><rect x="62" y="41" width="18" height="14" rx="3"/><rect x="85" y="41" width="18" height="14" rx="3"/><rect x="108" y="41" width="18" height="14" rx="3"/><rect x="131" y="41" width="18" height="14" rx="3"/><rect x="154" y="41" width="18" height="14" rx="3"/><rect x="177" y="41" width="18" height="14" rx="3"/><rect x="39" y="62" width="18" height="14" rx="3"/><rect x="62" y="62" width="18" height="14" rx="3"/><rect x="97" y="62" width="18" height="14" rx="3"/><rect x="120" y="62" width="18" height="14" rx="3"/><rect x="143" y="62" width="18" height="14" rx="3"/><rect x="166" y="62" width="29" height="14" rx="3"/></g><text x="44" y="73">Z</text><text x="67" y="73">X</text></svg>;
  if (controller === "joy-con") return <svg className="controller-illustration" viewBox="0 0 240 120" aria-hidden="true"><g className="controller-body"><rect x="57" y="10" width="47" height="100" rx="21"/><rect x="136" y="10" width="47" height="100" rx="21"/></g><g className="controller-button"><circle cx="80.5" cy="39" r="10"/><path d="M76 67h9v9h9v9h-9v9h-9v-9h-9v-9h9z"/><circle cx="159.5" cy="76" r="10"/><circle cx="159.5" cy="31" r="4"/><circle cx="159.5" cy="49" r="4"/><circle cx="150.5" cy="40" r="4"/><circle cx="168.5" cy="40" r="4"/></g><g className="controller-mark"><path d="M76 22h9M151 100h17"/></g></svg>;
  if (controller === "switch-pro") return <svg className="controller-illustration" viewBox="0 0 240 120" aria-hidden="true"><path className="controller-body" d="M51 35c12-14 31-18 51-10l8 4h20l8-4c20-8 39-4 51 10 14 17 22 55 10 67-11 11-27-2-41-21-9 10-21 15-38 15s-29-5-38-15c-14 19-30 32-41 21-12-12-4-50 10-67Z"/><g className="controller-button"><circle cx="88" cy="47" r="10"/><circle cx="146" cy="72" r="10"/><path d="M79 60h9v9h9v9h-9v9h-9v-9h-9v-9h9z"/><circle cx="166" cy="37" r="4"/><circle cx="166" cy="55" r="4"/><circle cx="157" cy="46" r="4"/><circle cx="175" cy="46" r="4"/></g><g className="controller-mark"><path d="M108 50h8M124 50h8"/></g></svg>;
  return <svg className="controller-illustration" viewBox="0 0 240 120" aria-hidden="true"><rect className="controller-body" x="92" y="7" width="56" height="106" rx="14"/><g className="controller-button"><circle cx="120" cy="38" r="19"/><circle cx="120" cy="38" r="6"/></g><g className="controller-mark"><path d="M106 72h28M108 83v12l10-6zM124 83v12l10-6z"/></g></svg>;
}
