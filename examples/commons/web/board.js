const list = document.querySelector('#tasks'), status = document.querySelector('#status');
let tasks;
try { tasks = JSON.parse(localStorage.getItem('commons-board') || 'null'); } catch {}
if (!Array.isArray(tasks) || tasks.some(t => typeof t?.text !== 'string' || typeof t.done !== 'boolean')) tasks = [{text:'Try this app from a mirror',done:false},{text:'Verify the release with your own trust key',done:false},{text:'Share a small improvement',done:false}];
function render() {
  list.replaceChildren();
  for (const task of tasks.slice(0,100)) {
    const item = document.createElement('li'), label = document.createElement('label'), input = document.createElement('input');
    input.type = 'checkbox'; input.checked = task.done;
    input.onchange = () => { task.done = input.checked; render(); };
    label.append(input, document.createTextNode(task.text)); item.append(label); list.append(item);
  }
  try { localStorage.setItem('commons-board',JSON.stringify(tasks)); } catch { status.textContent = 'Browser storage is unavailable; this list will not survive a reload.'; }
}
document.querySelector('#new').onsubmit = event => { event.preventDefault(); const input = document.querySelector('#task'); if(input.value.trim() && tasks.length < 100) tasks.push({text:input.value.trim(),done:false}); input.value=''; render(); };
render();
