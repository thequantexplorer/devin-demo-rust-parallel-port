// Tasks store tag ids in the order they were added. The API always returns them sorted.
function renderTask(task) {
  return { ...task, tagIds: [...task.tagIds].sort((a, b) => a - b) };
}

module.exports = { renderTask };
