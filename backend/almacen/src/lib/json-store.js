// Almacén clave-valor persistido en un archivo JSON. Usado para cachés (geocodificación, rutas)
// y para los archivos editables (coordenadas manuales, datos logísticos).
import fs from 'node:fs';
import path from 'node:path';

export class JsonStore {
  constructor(file, { defaults = {} } = {}) {
    this.file = file;
    this.defaults = defaults;
    this.data = null;
    this.mtime = 0;
    this.writeTimer = null;
  }

  // Relee el archivo si cambió en disco (permite editarlo a mano sin reiniciar el servidor).
  load() {
    try {
      const stat = fs.statSync(this.file);
      if (this.data && stat.mtimeMs === this.mtime) return this.data;
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.mtime = stat.mtimeMs;
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[store] No se pudo leer ${this.file}: ${err.message}`);
      if (!this.data) this.data = structuredClone(this.defaults);
    }
    return this.data;
  }

  get(key) {
    return this.load()[key];
  }

  set(key, value) {
    this.load()[key] = value;
    this.scheduleWrite();
  }

  scheduleWrite() {
    clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
    this.mtime = fs.statSync(this.file).mtimeMs;
  }
}
