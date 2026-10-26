import alertCircle from "./icons/line-md/alert-circle.svg?raw";
import arrowSmallLeft from "./icons/line-md/arrow-small-left.svg?raw";
import arrowSmallRight from "./icons/line-md/arrow-small-right.svg?raw";
import chevronSmallDown from "./icons/line-md/chevron-small-down.svg?raw";
import chevronSmallRight from "./icons/line-md/chevron-small-right.svg?raw";
import closeSmall from "./icons/line-md/close-small.svg?raw";
import confirmSquareTwotoneToSquareTransition from "./icons/line-md/confirm-square-twotone-to-square-transition.svg?raw";
import cog from "./icons/line-md/cog.svg?raw";
import squareToConfirmSquareTwotoneTransition from "./icons/line-md/square-to-confirm-square-twotone-transition.svg?raw";
import moonAlt from "./icons/line-md/moon-alt.svg?raw";
import starAlt from "./icons/line-md/star-alt.svg?raw";
import sunny from "./icons/line-md/sunny.svg?raw";
import camera from "./icons/camera.svg?raw";

const icons = {
  camera,
  "alert-circle": alertCircle,
  "arrow-small-left": arrowSmallLeft,
  "arrow-small-right": arrowSmallRight,
  "chevron-small-down": chevronSmallDown,
  "chevron-small-right": chevronSmallRight,
  "close-small": closeSmall,
  "confirm-square-twotone-to-square-transition": confirmSquareTwotoneToSquareTransition,
  cog,
  "moon-alt": moonAlt,
  "square-to-confirm-square-twotone-transition": squareToConfirmSquareTwotoneTransition,
  "star-alt": starAlt,
  sunny,
};

export function LineIcon({ name, size = 14 }: { name: keyof typeof icons; size?: 14 | 16 | 18 | 24 }) {
  return <span className="line-md-icon" style={{ width: size, height: size, flexBasis: size }} aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: icons[name] }} />;
}
