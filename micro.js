// Simple computer
// Marc Lepage, Fall 2017

'use strict';

const floor = Math.floor;

const VRAM = 0x0000;
const W = 192; // for graphics
const H = 128; // for graphics

// Format is one byte per character, each bit is a pixel.
// LSB is top left, next bit is to right, row major order.
// abcde  first row is always blank (and omitted)
// fABCD  first col is always blank (but present)
// gEFGH  XWVUkTSRQj...HGFEgDCBAf is the order (MSB to LSB)
// hIJKL
// iMNOP
// jQRST
// kUVWX
const crom = []; // character rom

const mrom = {}; // module rom

const systraceEnable = {
  'beep': true,
  'cd': true,
  'export': true,
  'gchar': false,
  'gclear': false,
  'gpixel': false,
  'grect': false,
  'gtext': false,
  'import': true,
  'input': true,
  'load': true,
  'ls': true,
  'open': true,
  'output': true,
  'print': true,
  'read': true,
  'reboot': true,
  'seek': true,
  'spawn': true,
  'vc': true,
  'write': true,
};

function systrace(name, sys, ...args) {
  if (systraceEnable[name])
    console.log(`syscall ${name}`, sys, args);
}

const demoHello = `-- hello (demo)
write('What is your name? ')
name = read()
print('Hello', name)
`;

const demoBounce = `-- bounce (demo)
x,y = 0,0
dx,dy = 2,1

function update()
  x,y = x+dx,y+dy
  if (x <= 0 or 192 <= x) then dx = -dx end
  if (y <= 0 or 128 <= y) then dy = -dy end
end

function draw()
  clear(2)
  rect(x-4, y-4, 8, 8, 8)
end
`;

function localStorageAvailable() {
  try {
    localStorage.setItem('mcomputer', 'test');
    const result = localStorage.getItem('mcomputer') == 'test';
    localStorage.removeItem('mcomputer');
    return result;
  } catch(e) {
    return false;
  }
}

const filesystem = localStorageAvailable() ? localStorage : {};
filesystem['mcomputer:/'] = true;
filesystem['mcomputer:/hello'] = demoHello;
filesystem['mcomputer:/bounce'] = demoBounce;

// File handle looks like: { file:'/full/path/name', key:'mcomputer:/full/path/name', mode:'r+', pos:123 }
function isFile(handle) {
  return handle && handle.file;
}

// Terminal handle looks like: { terminal:<terminal> }
function isTerminal(handle) {
  return handle && handle.terminal;
}

const fileModes = { 'r':true, 'w':true, 'a':true, 'r+':true, 'w+':true, 'a+':true };

function fileOpen(filename, mode) {
  if (typeof filename !== 'string')
    return undefined;
  if (mode === undefined)
    mode = 'r';
  else if (!fileModes[mode])
    return undefined;
  // TODO relative paths './foo' '../foo' '..//../././//foo' etc. using cwd
  // TODO absolute paths (already have '/' root)
  const key = `mcomputer:/${filename}`;
  var pos = 0;
  switch (mode) {
    case 'r':
    case 'r+':
      if (filesystem[key] === undefined)
        return undefined;
      break;
    case 'w':
    case 'w+':
      filesystem[key] = '';
      break;
    case 'a':
      if (filesystem[key] !== undefined)
        pos = filesystem[key].length;
        // fall through
    case 'a+':
      if (filesystem[key] === undefined)
        filesystem[key] = '';
      break;
  }
  return { file:`/${filename}`, key:key, mode:mode, pos:pos };
}

// TODO need file error states (e.g. eof)

function fileRead(handle, ...args) {
  console.log('fileRead', handle, ...args);
  if (handle.mode === 'w' || handle.mode === 'a')
    return undefined;
  var file = filesystem[handle.key];
  var pos = handle.pos;
  var arg = args.shift();
  if (arg === undefined)
    arg = 'l';
  if (arg === 'l' || arg === 'L') {
    if (pos === file.length)
      return undefined; // eof
    const idx = file.indexOf('\n', pos);
    if (idx === -1) {
      handle.pos = file.length;
      return file.slice(pos);
    } else {
      handle.pos = idx+1;
      return file.slice(pos, idx + (arg === 'L' ? 1 : 0));
    }
  } else if (arg === 'a') {
    handle.pos = file.length;
    return file.slice(pos); // eof --> empty string
  }
}

function fileSeek(handle, ...args) {
  console.log('fileSeek', handle, ...args);
}

function fileWrite(handle, ...args) {
  console.log('fileWrite', handle, ...args);
  if (handle.mode === 'r')
    return -1;
  var file = filesystem[handle.key];
  var pos = (handle.mode.charAt() === 'a') ? file.length : handle.pos;
  var written = 0;
  while (true) {
    var arg = args.shift();
    if (typeof arg === 'number')
      arg = String(arg);
    else if (typeof arg !== 'string')
      break;
    file = file.slice(0, pos) + arg + file.slice(pos + arg.length);
    pos += arg.length;
    written += arg.length;
  }
  filesystem[handle.key] = file;
  handle.pos = pos;
  return written;
}

// global
window.loadedFile = undefined;

module.exports = class Micro {

  constructor(opts) {
    // TODO probably should go into a device profile
    // and be exposed to both bsp and to processes
    this.w = 192; // screen width
    this.h = 128; // screen height
    this.cw = 5; // char width
    this.ch = 7; // char height
    
    this.filesystem = filesystem; // HACK
    this.syscall = {
      _os: this,
      beep: this.syscall_beep,
      cd: this.syscall_cd,
      export: this.syscall_export,
      gchar: this.syscall_gchar,
      gclear: this.syscall_gclear,
      gpixel: this.syscall_gpixel,
      grect: this.syscall_grect,
      gtext: this.syscall_gtext,
      import: this.syscall_import,
      input: this.syscall_input,
      load: this.syscall_load,
      ls: this.syscall_ls,
      open: this.syscall_open,
      output: this.syscall_output,
      print: this.syscall_print,
      read: this.syscall_read,
      reboot: this.syscall_reboot,
      seek: this.syscall_seek,
      spawn: this.syscall_spawn,
      vc: this.syscall_vc,
      write: this.syscall_write,
      // graphics
      clear: this.syscall_clear,
      pal: this.syscall_pal,
      pget: this.syscall_pget,
      pset: this.syscall_pset,
      rect: this.syscall_rect,
    };
    
    this.sys = Object.create(this.syscall);
    this.sys._process = this;
  }

  async reboot() {
    this.sys._cwd = '/';
    
    // 0x3000 will store 192x128 graphics buffer (two pixels per byte)
    this.mem = new Uint8Array(0x3000);
    this.gstate = {
      c: 0,
      pal: [ 0x80, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 ],
    }; // graphics state
    
    this.VC = []; // virtual consoles
    this.vc = this.VC; // current virtual console (temporarily not a vc)
    this.editor = 1; // index of most recently used editor
    this.virtualConsole(0);
  }

  virtualConsole(id, process) {
    if (this.interval) {
      clearInterval(this.interval);
      delete this.interval;
    }
    if (this.vc.onSuspend) {
      this.vc.onSuspend();
    }
    if (process) {
      this.VC[id] = process; // TODO reparent process to _os
    }
    this.vc = this.VC[id];
    if (!this.vc) {
      this.vc = this.VC; // temporarily not a vc
      switch (id) {
        case 0:
          this.vc = this.sys.spawn('terminal');
          this.vc.write("console           type 'help' for help\n\n");
          this.vc.setProcess(this.sys.spawn('shell'));
          break;
        case 1: this.vc = this.sys.spawn('code-editor'); break;
        case 2: this.vc = this.sys.spawn('sprite-editor'); break;
        case 3: this.vc = this.sys.spawn('map-editor'); break;
        case 4: this.vc = this.sys.spawn('sound-editor'); break;
        case 5: this.vc = this.sys.spawn('music-editor'); break;
        case 8: this.vc = this.sys.spawn('breakout'); break;
        case 9:
          this.vc = this.sys.spawn('terminal');
          this.vc.write('micro terminal\n\n');
          break;
        case 10:
          this.vc = this.sys.spawn('terminal');
          this.vc.write('micro shell\n\n');
          this.vc.setProcess(this.sys.spawn('shell'));
          break;
      }
      this.VC[id] = this.vc;
    }
    if (1 <= id && id <= 5) {
      this.editor = id;
    }
    if (this.vc.onResume) {
      this.vc.onResume();
    }
    if (this.vc.onUpdate) {
      this.interval = setInterval(() => {
        this.vc.onUpdate();
        this.vc.onDraw();
      }, 1000/30);
    }
    this.onDraw();
  }

  // syscall -------------------------------------------------------------------

  syscall_beep() {
    systrace('beep', this, arguments);
    this.beep = this._os.bspAudioBeep.bind(this._os);
    return this.beep();
  }

  // TODO need to handle '..', '../..', 'dir', 'dir/', etc.
  syscall_cd(dir) {
    systrace('cd', this, arguments);
    if (dir === undefined)
      return this._cwd;
    if (dir.charAt(dir.length-1) !== '/')
      dir += '/';
    if (dir.charAt(0) !== '/')
      dir = this._cwd + dir;
    const key = `mcomputer:${dir}`;
    if (filesystem[key]) {
      this._cwd = dir;
      return dir;
    }
  }

  syscall_export() {
    systrace('export', this, arguments);
    const json = JSON.stringify(filesystem);
    this._os.bspExport('filesystem.json', json);
  }

  syscall_gchar(ch, x, y, fg, bg) {
    systrace('gchar', this, arguments);
    // TODO switch to this eventually
    //this.gclear = this._os.bspScreenClear.bind(this._os);
    //return this.gclear(c);
    
    // TODO this could use speeding up
    const micro = this._os;
    var bmp = crom[ch.charCodeAt()-32];
    const x0 = x, xw = x+micro.cw, yh = y+micro.ch;
    if (bg !== undefined)
      for (x = x0; x < xw; ++x)
        micro.bspScreenPixel(x, y, bg);
    for (++y; y < yh; ++y)
      for (x = x0; x < xw; ++x, bmp >>>= 1)
        if (((bmp&1) === 1) && fg !== undefined) micro.bspScreenPixel(x, y, fg);
        else if (((bmp&1) === 0) && bg !== undefined) micro.bspScreenPixel(x, y, bg);
  }

  syscall_gclear(c) {
    systrace('gclear', this, arguments);
    this.gclear = this._os.bspScreenClear.bind(this._os);
    return this.gclear(c);
  }

  syscall_gpixel(x, y, c) {
    systrace('gpixel', this, arguments);
    this.gpixel = this._os.bspScreenPixel.bind(this._os);
    return this.gpixel(x, y, c);
  }

  syscall_grect(x, y, w, h, c) {
    systrace('grect', this, arguments);
    this.grect = this._os.bspScreenRect.bind(this._os);
    return this.grect(x, y, w, h, c);
  }

  syscall_gtext(str, x, y, fg, bg) {
    systrace('gtext', this, arguments);
    for (var i = 0, count = str.length; i < count; ++i, x+=5) {
      this.gchar(str.charAt(i), x, y, fg, bg);
    }
  }

  syscall_import() {
    systrace('import', this, arguments);
    this._os.bspImport();
  }

  syscall_input(file) {
    systrace('input', this, arguments);
  }

  syscall_load(filename) {
    systrace('load', this, arguments);
    const handle = fileOpen(filename, 'r');
    if (handle) {
      window.loadedFile = handle.file
      this.print('ok');
    } else {
      this.print('load error');
    }
  }

  syscall_ls() {
    systrace('ls', this, arguments);
    const list = [];
    const len = 10 + this._cwd.length;
    const regex = new RegExp(`^mcomputer:${this._cwd}[^/]+/?$`);
    for (var key in filesystem)
      if (filesystem.hasOwnProperty(key) && regex.test(key))
        list.push(key.slice(len));
    return list;
  }

  // Sounds like open should create new file descriptor
  // but sometimes (spawn) you want to dup
  // https://stackoverflow.com/questions/5284062/two-file-descriptors-to-same-file

  syscall_open(filename, mode) {
    systrace('open', this, arguments);
    return fileOpen(filename, mode);
  }

  syscall_output(file) {
    systrace('output', this, arguments);
  }

  syscall_print(...args) {
    systrace('print', this, arguments);
    this.write(args.join(' ') + '\n');
  }

  // read ([handle,] fmt)
  async syscall_read(...args) {
    systrace('read', this, arguments);
    var handle;
    if (isTerminal(args[0]) || isFile(args[0])) {
      handle = args.shift();
    } else {
      handle = this._input;
    }
    if (handle.terminal) {
      return handle.terminal.read(handle, ...args);
    } else {
      return fileRead(handle, ...args);
    }
  }

  syscall_reboot() {
    systrace('reboot', this, arguments);
    this._os.reboot();
  }

  syscall_seek(fd, offset, whence) {
    systrace('seek', this, arguments);
    // TODO seek, but not for terminals
  }

  syscall_spawn(...args) {
    systrace('spawn', this, arguments);
    const name = args[0];
    var M = mrom[name];
    if (!M) M = mrom[name] = require(`./${name}.js`);
    const process = new M();
    process.sys = Object.create(this._os.syscall);
    process.sys._name = name;
    process.sys._process = process;
    process.sys._parent = this._process;
    process.sys._cwd = this._cwd;
    process.sys._terminal = { terminal:this._os.vc }; // TODO get from parent
    process.sys._input = process.sys._terminal; // TODO get from parent (dup?)
    process.sys._output = process.sys._terminal; // TODO get from parent (dup?)
    // currently, wait for child like this:
    // const exitStatus = this.sys.spawn('prog', ...args).sys._main
    process.sys._main = new Promise((resolve, reject) => {
      resolve(process.main ? process.main(...args) : 0);
    });
    return process;
  }

  // Equivalent of linux openvt/chvt (TODO improve API)
  syscall_vc(id, process) {
    systrace('vc', this, arguments);
    this._os.virtualConsole(id, process);
  }

  // write ([fd,] ...)
  // Writes the value of each of its arguments to handle. The arguments must be strings or numbers.
  syscall_write(...args) {
    systrace('write', this, arguments);
    var handle;
    if (isTerminal(args[0]) || isFile(args[0])) {
      handle = args.shift();
    } else {
      handle = this._output;
    }
    if (handle.terminal) {
      return handle.terminal.write(...args);
    } else {
      return fileWrite(handle, ...args);
    }
  }

  // graphics ------------------------------------------------------------------

  syscall_clear(c) {
    const os = this._os;
    if (c === undefined) c = os.gstate.c; // default color
    os.bspScreenClear(c);
    //c |= c<<4; // two pixels per byte
    //this._os.memset(VRAM, c, W*H/2);
  }

  syscall_circle(x, y, r, c, fill) {
  }

  syscall_line(x1, y1, x2, y2, c) {
  }

  // pal c1 c2 [trans]
  syscall_pal(c1, c2, trans) {
    this._os.gstate.pal[c1] = c2 | (trans?0x80:0x00);
  }

  // pget x y
  syscall_pget(x, y) {
    const addr = VRAM + floor((y*W + x)/2); // 2px per byte ordered 1100 3322 5544 ...
    const byte = this._os.mem[addr];
    return (byte >>> (4*(x%2))) & 0xf;
  }

  // pset x y [c]
  syscall_pset(x, y, c) {
    const os = this._os;
    if (c === undefined) c = os.gstate.c; // default color
    c = os.gstate.pal[c]; // palette mapping
    if (c&0x80) return; // transparent
    os.bspScreenPixel(x, y, c);
    //const addr = VRAM + floor((y*W + x)/2); // 2px per byte ordered 1100 3322 5544 ...
    //var byte = os.mem[addr];
    //byte &= 0xf0 >>> (4*(x%2));
    //byte |= c << (4*(x%2));
    //os.mem[addr] = byte;
  }

  syscall_rect(x, y, w, h, c, fill) {
    const os = this._os;
    if (c === undefined) c = os.gstate.c; // default color
    c = os.gstate.pal[c]; // palette mapping
    if (c&0x80) return; // transparent
    os.bspScreenRect(x, y, w, h, c);
    // TODO set vram
  }

  syscall_text() {
  }

  // memory --------------------------------------------------------------------

  memcpy(dest_addr, source_addr, len) {
    if (dest_addr < source_addr) {
      while (len--) this.mem[dest_addr++] = this.mem[source_addr++];
    } else if (source_addr < dest_addr) {
      dest_addr += len;
      source_addr += len;
      while (len--) this.mem[--dest_addr] = this.mem[--source_addr];
    }
  }

  memset(dest_addr, val, len) {
    while (len--) this.mem[dest_addr++] = val;
  }

  peek(addr) {
    //if (addr < 0 || 0x7fff < addr) throw 'SIGSEGV';
    return this.mem[addr];
  }

  poke(addr, val) {
    //if (addr < 0 || 0x7fff < addr) throw 'SIGSEGV';
    this.mem[addr] = val;
  }

  // ---------------------------------------------------------------------------

  onDraw() {
    if (this.vc.onDraw) this.vc.onDraw();
  }

  onFileImport(name, contents) {
    // HACK
    var obj;
    try {
      obj = JSON.parse(contents);
    } catch (e) {
    }
    if (!obj)
      return;
    var key;
    for (key in filesystem)
      if (filesystem.hasOwnProperty(key))
        delete filesystem[key];
    for (key in obj)
      if (obj.hasOwnProperty(key))
        filesystem[key] = obj[key];
  }

  onKeyDown(e) {
    if (e.ctrlKey) {
      if (!e.altKey && !e.metaKey && !e.shiftKey) {
        if (e.code == 'Backquote') {
          this.virtualConsole(0); e.preventDefault(); return;
        } else if (e.code == 'Digit1') {
          this.virtualConsole(1); e.preventDefault(); return;
        } else if (e.code == 'Digit2') {
          this.virtualConsole(2); e.preventDefault(); return;
        } else if (e.code == 'Digit3') {
          this.virtualConsole(3); e.preventDefault(); return;
        } else if (e.code == 'Digit4') {
          this.virtualConsole(4); e.preventDefault(); return;
        } else if (e.code == 'Digit5') {
          this.virtualConsole(5); e.preventDefault(); return;
        } else if (e.code == 'Digit7') {
          this.virtualConsole(7); e.preventDefault(); return;
        } else if (e.code == 'Digit8') {
          this.virtualConsole(8); e.preventDefault(); return;
        } else if (e.code == 'Digit9') {
          this.virtualConsole(9); e.preventDefault(); return;
        } else if (e.code == 'Digit0') {
          this.virtualConsole(10); e.preventDefault(); return;
        }
      }
      this.onDraw();
      return;
    }
    if (e.key == 'Escape') {
      this.virtualConsole(this.vc == this.VC[0] ? this.editor : 0);
      e.preventDefault();
      this.onDraw();
      return;
    }
    if (this.vc.onKeyDown) this.vc.onKeyDown(e);
    e.preventDefault();
    this.onDraw();
  }

  onMouseClick(e) {
    if (this.vc.onMouseClick) this.vc.onMouseClick(e);
    e.preventDefault();
    this.onDraw();
  }

  onMouseWheel(e) {
    if (this.vc.onMouseWheel) this.vc.onMouseWheel(e);
    e.preventDefault();
    this.onDraw();
  }

  // bsp -----------------------------------------------------------------------

  // NOTE currently using bsp_blah for bsp-private storage

  bspAudioBeep() {console.log('bspAudioBeep')}

  bspExport(name, contents) {console.log('bspExport')}

  bspImport() {console.log('bspImport')}

  bspScreenChar(ch, x, y, fg, bg) {console.log('bspScreenChar')}

  bspScreenClear(c) {console.log('bspScreenClear')}

  bspScreenPixel(x, y, c) {console.log('bspScreenPixel')}

  bspScreenRect(x, y, w, h, c) {console.log('bspScreenRect')}

  // TODO deal with character rom, palette rom, size, scale, etc.
  ctlCharacterRom(rom) {
    for (var i = 0; i < 96; ++i) crom[i] = rom[i];
  }

};
