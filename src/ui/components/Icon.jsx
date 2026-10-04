// Material Symbols (rounded, 400) rendered as masked SVG so we bundle only the
// glyphs we actually use. `sym(name)` returns { className, style } to spread on
// a <span className="sym" .../>. Import the SVG as a URL (Vite inlines small).
import menu from "@material-symbols/svg-400/rounded/menu.svg?url";
import add from "@material-symbols/svg-400/rounded/add.svg?url";
import search from "@material-symbols/svg-400/rounded/search.svg?url";
import close from "@material-symbols/svg-400/rounded/close.svg?url";
import send from "@material-symbols/svg-400/rounded/send.svg?url";
import mic from "@material-symbols/svg-400/rounded/mic.svg?url";
import refresh from "@material-symbols/svg-400/rounded/refresh.svg?url";
import more_vert from "@material-symbols/svg-400/rounded/more_vert.svg?url";
import content_copy from "@material-symbols/svg-400/rounded/content_copy.svg?url";
import share from "@material-symbols/svg-400/rounded/share.svg?url";
import edit from "@material-symbols/svg-400/rounded/edit.svg?url";
import restart_alt from "@material-symbols/svg-400/rounded/restart_alt.svg?url";
import expand_content from "@material-symbols/svg-400/rounded/expand_content.svg?url";
import stop from "@material-symbols/svg-400/rounded/stop.svg?url";
import arrow_downward from "@material-symbols/svg-400/rounded/arrow_downward.svg?url";
import check from "@material-symbols/svg-400/rounded/check.svg?url";
import folder_open from "@material-symbols/svg-400/rounded/folder_open.svg?url";
import folder from "@material-symbols/svg-400/rounded/folder.svg?url";
import description from "@material-symbols/svg-400/rounded/description.svg?url";
import image from "@material-symbols/svg-400/rounded/image.svg?url";
import difference from "@material-symbols/svg-400/rounded/difference.svg?url";
import terminal from "@material-symbols/svg-400/rounded/terminal.svg?url";
import travel_explore from "@material-symbols/svg-400/rounded/travel_explore.svg?url";
import extension from "@material-symbols/svg-400/rounded/extension.svg?url";
import smart_toy from "@material-symbols/svg-400/rounded/smart_toy.svg?url";
import settings from "@material-symbols/svg-400/rounded/settings.svg?url";
import account_tree from "@material-symbols/svg-400/rounded/account_tree.svg?url";
import palette from "@material-symbols/svg-400/rounded/palette.svg?url";
import chevron_right from "@material-symbols/svg-400/rounded/chevron_right.svg?url";
import arrow_back from "@material-symbols/svg-400/rounded/arrow_back.svg?url";
import light_mode from "@material-symbols/svg-400/rounded/light_mode.svg?url";
import dark_mode from "@material-symbols/svg-400/rounded/dark_mode.svg?url";
import contrast from "@material-symbols/svg-400/rounded/contrast.svg?url";

const ICONS = {
  menu,
  add,
  search,
  close,
  send,
  mic,
  refresh,
  more_vert,
  content_copy,
  share,
  edit,
  restart_alt,
  expand_content,
  stop,
  arrow_downward,
  check,
  folder_open,
  folder,
  description,
  image,
  difference,
  terminal,
  travel_explore,
  extension,
  smart_toy,
  settings,
  account_tree,
  palette,
  chevron_right,
  arrow_back,
  light_mode,
  dark_mode,
  contrast,
};

export function sym(name, size) {
  const url = ICONS[name];
  const style = url
    ? {
        WebkitMaskImage: `url("${url}")`,
        maskImage: `url("${url}")`,
      }
    : undefined;
  const className = size ? `sym sym-${size}` : "sym";
  return { className, style, "aria-hidden": "true" };
}

export function Icon({ name, size = 20, className = "", ...rest }) {
  const props = sym(name, size);
  return <span {...props} className={`${props.className} ${className}`.trim()} {...rest} />;
}
