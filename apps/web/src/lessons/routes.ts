export function lessonEditId(path: string) {
  return /^\/lessons\/([a-z0-9]+(?:-[a-z0-9]+)*)\/edit\/?$/.exec(path)?.[1];
}

export function lessonEditPath(id: string) {
  return `/lessons/${id}/edit`;
}
