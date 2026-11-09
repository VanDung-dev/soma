export function lessonEditId(path: string) {
  return /^\/lessons\/([a-z0-9]+(?:-[a-z0-9]+)*)\/edit\/?$/.exec(path)?.[1];
}

export function lessonEditPath(id: string) {
  return `/lessons/${id}/edit`;
}

export function lessonViewId(path: string) {
  return /^\/lessons\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(path)?.[1];
}

export function lessonViewPath(id: string) {
  return `/lessons/${id}`;
}
