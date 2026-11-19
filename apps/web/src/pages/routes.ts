import { lessonEditId, lessonViewId } from "../lessons/routes.ts";

export function pageAtPath(pathname: string) {
  switch (pathname.replace(/\/+$/, "")) {
    case "":
    case "/home": return "home";
    case "/anatomy": return "anatomy";
    case "/games": return "games";
    case "/settings": return "settings";
    case "/lessons": return "lessons";
    default: return lessonEditId(pathname) || lessonViewId(pathname) ? "lessons" : null;
  }
}
