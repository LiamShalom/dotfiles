// Loaded through NODE_OPTIONS by heavy-gate.sh for e2e commands (playwright test, npm run e2e).
// In an Electron main process it keeps every window invisible and click-through and never lets the
// app take focus or show a Dock icon, so e2e runs on any branch stay off Liam's screen. Tests still
// drive the windows over CDP, and isVisible() stays true. Everywhere else it does nothing.
//
// Playwright deletes NODE_OPTIONS when it launches Electron, so in the Node runner this file adds
// itself as a `-r` argument to every Electron it spawns.
//
// Preloads run before Electron registers the 'electron' module, so the patch waits for the first
// require('electron') (Playwright's loader makes it before the app's code runs).
if (!process.versions.electron) {
  const childProcess = require('child_process')
  const spawn = childProcess.spawn
  const isElectron = (command) => typeof command === 'string' && /(^|[/\\])electron(\.exe)?$/i.test(command)
  childProcess.spawn = function (command, args, ...rest) {
    if (isElectron(command) && Array.isArray(args)) args = ['-r', __filename, ...args]
    return spawn.call(this, command, args, ...rest)
  }
} else if (process.type === 'browser') {
  const Module = require('module')
  const load = Module._load
  let wrapped = null
  Module._load = function (request, ...rest) {
    const result = load.call(this, request, ...rest)
    if (request !== 'electron') return result
    if (!wrapped) {
      try {
        wrapped = hide(result)
      } catch (err) {
        console.error('[e2e-electron-hidden]', err)
        wrapped = result
      }
    }
    return wrapped
  }
}

function hide(electron) {
  const { app, BrowserWindow } = electron
  const proto = BrowserWindow.prototype
  proto.show = function show() {
    return this.showInactive()
  }
  proto.focus = function focus() {}
  proto.moveTop = function moveTop() {}
  app.focus = () => {}
  app.on('browser-window-created', (_event, win) => {
    win.setOpacity(0)
    win.setIgnoreMouseEvents(true)
  })
  // Before launch finishes, so macOS never makes the app active or gives it a Dock icon.
  if (process.platform === 'darwin') app.setActivationPolicy('accessory')

  // A window made with the default show: true activates the app in its constructor, before any
  // event fires, so every window is made hidden and then shown without activating. The module's
  // own BrowserWindow can't be redefined, so callers get a view of the module that swaps it.
  class HiddenWindow extends BrowserWindow {
    constructor(options = {}) {
      super({ ...options, show: false, opacity: 0 })
      if (options.show !== false) this.showInactive()
    }
  }
  return Object.create(electron, { BrowserWindow: { value: HiddenWindow, enumerable: true } })
}
