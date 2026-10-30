import { createRoot } from 'react-dom/client';
import { GeometryScene } from '../src/GeometryScene.js';
import { parseGeometryScene } from '../src/geometry-scene.js';

declare global {
  interface Window {
    geometryFixture: unknown;
    renderGeometry: (scene: unknown) => void;
  }
}

const host = document.getElementById('root');
if (!host) throw new Error('Missing React host');
const root = createRoot(host);
window.renderGeometry = input => root.render(<GeometryScene scene={parseGeometryScene(input)} label="Geometry example" />);
try {
  const response = await fetch('./geometry.json');
  if (!response.ok) throw new Error(`Scene request failed: ${response.status}`);
  window.geometryFixture = await response.json();
  window.renderGeometry(window.geometryFixture);
} catch (error) {
  host.textContent = error instanceof Error ? error.message : String(error);
  throw error;
}
