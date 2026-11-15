import {createSceneryMap} from './map.js';
import {inventoryRecords, sampleInventory, sampleRecords} from './data.js';

const element = id => document.getElementById(id);
const layouts = ['overview', 'inspector'];
let layout = new URLSearchParams(location.search).get('variant') ?? 'overview';
if (!layouts.includes(layout)) {
  layout = 'overview';
}
let library = sampleRecords('normal');
let imported = null;
let importedName = '';
let sourceRevision = 0;
let selectedId = null;
let camera = {};
let visible = [];

const map = createSceneryMap(
  element('map'),
  choose,
  value => {
    camera = value;
    showState();
  },
  label => {
    element('hover-name').textContent =
      label || 'Select an airport point to inspect its installations.';
  }
);

function showState() {
  element('state').textContent = JSON.stringify(
    {
      layout,
      scenario: element('scenario').value,
      simulator: element('sim').value,
      locations: element('locations').value,
      search: element('search').value,
      selectedId,
      visibleIds: visible.map(record => record.id),
      camera,
    },
    null,
    2
  );
}

function choose(id) {
  selectedId = id;
  render();
}

function selectedRecord() {
  return visible.find(record => record.id === selectedId);
}

function render() {
  const query = element('search').value.toLowerCase();
  const simulator = element('sim').value;
  const locations = element('locations').value;
  visible = library.filter(record => {
    if (simulator !== 'all' && record.sim !== simulator) {
      return false;
    }
    if (locations === 'located' && !record.position) {
      return false;
    }
    if (locations === 'unavailable' && record.position) {
      return false;
    }
    return `${record.code} ${record.name} ${record.packageName} ${record.folderName}`
      .toLowerCase()
      .includes(query);
  });
  if (!visible.some(record => record.id === selectedId)) {
    selectedId = null;
  }
  const airports = visible.filter(record => record.kind === 'airport');
  const located = airports.filter(record => record.position);
  const packageCount = new Set(visible.map(record => record.packageId)).size;
  const pointCount = new Set(located.map(record => JSON.stringify(record.position))).size;
  element('counts').textContent =
    `${packageCount} packages · ${located.length} located airport records at ${pointCount} locations · ${airports.length - located.length} airport records without coordinates · ${visible.length - airports.length} other scenery packages`;
  const missingParents = visible.filter(record => record.missingParent).length;
  element('diagnostic').textContent = missingParents
    ? `${missingParents} airport records have no matching package. Package folder names appear in their place.`
    : '';
  element('source-label').textContent =
    element('scenario').value === 'imported'
      ? `Imported · ${importedName}`
      : 'Sample library · illustrative records';
  element('inventory').replaceChildren();
  for (const record of visible) {
    const button = document.createElement('button');
    button.className = 'row' + (selectedId === record.id ? ' selected' : '');
    button.setAttribute('aria-pressed', String(selectedId === record.id));
    const title = document.createElement('span');
    title.textContent = `${record.code || 'Scenery'} · ${record.name}`;
    const subtitle = document.createElement('small');
    subtitle.textContent = `${record.sim} · ${record.position ? record.packageName : 'Location unavailable'}`;
    button.append(title, subtitle);
    button.onclick = () => choose(record.id);
    element('inventory').append(button);
  }
  if (!visible.length) {
    element('inventory').textContent =
      'No matching scenery. Change the filters or choose another library.';
  }
  const record = selectedRecord();
  element('detail-title').textContent = record
    ? `${record.code || 'Scenery'} · ${record.name}`
    : 'Select an airport or package';
  element('detail-text').textContent =
    'Choose a point or an installation from the list. Missing coordinates are never plotted.';
  if (record) {
    const location = record.position
      ? `${record.position[1]}°, ${record.position[0]}°`
      : 'Location unavailable';
    element('detail-text').textContent =
      `${record.packageName} · ${record.sim} · ${location}`;
  }
  element('focus').disabled = !record?.position;
  element('coincident').replaceChildren();
  if (record?.position) {
    const sameLocation = visible.filter(
      candidate => JSON.stringify(candidate.position) === JSON.stringify(record.position)
    );
    if (sameLocation.length > 1) {
      const label = document.createElement('p');
      label.textContent = 'Installations at this location';
      element('coincident').append(label);
      for (const candidate of sameLocation) {
        const button = document.createElement('button');
        button.textContent = `${candidate.sim} · ${candidate.packageName}`;
        button.onclick = () => choose(candidate.id);
        element('coincident').append(button);
      }
    }
  }
  map.update(located, selectedId);
  showState();
}

function showLayout() {
  document.body.dataset.layout = layout;
  element('variant-label').textContent =
    layout === 'overview' ? 'Map explorer' : 'Inventory inspector';
  showState();
}

function switchLayout() {
  layout = layouts[(layouts.indexOf(layout) + 1) % layouts.length];
  const url = new URL(location.href);
  url.searchParams.set('variant', layout);
  history.replaceState(null, '', url);
  showLayout();
}

for (const id of ['search', 'sim', 'locations']) {
  element(id).oninput = render;
}
element('scenario').onchange = () => {
  sourceRevision += 1;
  library =
    element('scenario').value === 'imported'
      ? imported
      : sampleRecords(element('scenario').value);
  selectedId = null;
  element('import-status').textContent = '';
  map.reset();
  render();
};
element('import').onchange = async event => {
  const file = event.target.files[0];
  if (!file) {
    return;
  }
  const revision = ++sourceRevision;
  element('import-status').textContent = `Read ${file.name}…`;
  try {
    const records = inventoryRecords(JSON.parse(await file.text()));
    if (revision !== sourceRevision) {
      return;
    }
    imported = records;
    importedName = file.name;
    library = records;
    element('imported-option').disabled = false;
    element('scenario').value = 'imported';
    selectedId = null;
    element('import-status').textContent =
      `Loaded ${file.name}. Data stays in this page.`;
    map.reset();
    render();
  } catch (error) {
    if (revision === sourceRevision) {
      element('import-status').textContent =
        `Could not import ${file.name}. ${error.message} The previous library remains visible.`;
    }
  }
  event.target.value = '';
};
element('download').onclick = () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(sampleInventory, null, 2)], {type: 'application/json'})
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'scenery-sample-inventory.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
element('prev').onclick = switchLayout;
element('next').onclick = switchLayout;
element('zoom-in').onclick = () => map.zoom(1.5);
element('zoom-out').onclick = () => map.zoom(1 / 1.5);
element('reset').onclick = () => map.reset();
element('focus').onclick = () => {
  const record = selectedRecord();
  if (record?.position) {
    map.focus(record.position);
  }
};
document.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select, [contenteditable], #map')) {
    return;
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    switchLayout();
  }
});
window.addEventListener('popstate', () => {
  const variant = new URLSearchParams(location.search).get('variant');
  layout = layouts.includes(variant) ? variant : 'overview';
  showLayout();
});
new ResizeObserver(() => map.resize()).observe(element('map'));
showLayout();
render();
