import alertCircle from "./icons/line-md/alert-circle.svg?raw";
import arrowSmallLeft from "./icons/line-md/arrow-small-left.svg?raw";
import chevronSmallDown from "./icons/line-md/chevron-small-down.svg?raw";
import chevronSmallRight from "./icons/line-md/chevron-small-right.svg?raw";
import closeSmall from "./icons/line-md/close-small.svg?raw";
import confirmSquareTwotone from "./icons/line-md/confirm-square-twotone.svg?raw";
import confirmSquareTwotoneToSquareTransition from "./icons/line-md/confirm-square-twotone-to-square-transition.svg?raw";
import cog from "./icons/line-md/cog.svg?raw";
import square from "./icons/line-md/square.svg?raw";
import squareToConfirmSquareTwotoneTransition from "./icons/line-md/square-to-confirm-square-twotone-transition.svg?raw";

const icons = {
  "alert-circle": alertCircle,
  "arrow-small-left": arrowSmallLeft,
  "chevron-small-down": chevronSmallDown,
  "chevron-small-right": chevronSmallRight,
  "close-small": closeSmall,
  "confirm-square-twotone": confirmSquareTwotone,
  "confirm-square-twotone-to-square-transition": confirmSquareTwotoneToSquareTransition,
  cog,
  square,
  "square-to-confirm-square-twotone-transition": squareToConfirmSquareTwotoneTransition,
};

export function LineIcon({ name, size = 14 }: { name: keyof typeof icons; size?: 14 | 16 | 18 }) {
  return <span className="line-md-icon" style={{ width: size, height: size, flexBasis: size }} aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: icons[name] }} />;
}
