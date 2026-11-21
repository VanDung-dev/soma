export async function measureSearch(queries = ['femur', 'xuong', 'x'], rounds = 3) {
  const input = document.querySelector('.structure-search input');
  if (input.disabled) throw Error('Wait for startup to finish');
  const previous = input.value;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const enter = async query => {
    const start = performance.now();
    setter.call(input, query);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const tree = document.querySelector('.catalog-tree');
    tree.getBoundingClientRect();
    return { ms: Math.round(performance.now() - start), rows: tree.querySelectorAll('.tree-row').length,
      elements: tree.querySelectorAll('*').length,
      resultRows: tree.querySelectorAll('.tree-name:has(mark)').length };
  };
  const results = [];
  try {
    for (const query of queries) {
      await enter(''); await enter(query);
      const samples = [];
      for (let i = 0; i < rounds; i++) {
        await enter('');
        samples.push(await enter(query));
      }
      const times = samples.map(sample => sample.ms).sort((a, b) => a - b);
      results.push({ query, medianMs: times[Math.floor(times.length / 2)], samples });
    }
    return results;
  } finally {
    await enter(previous);
  }
}
