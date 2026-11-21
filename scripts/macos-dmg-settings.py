import os

if "filename" in locals() and filename:
    os.makedirs(os.path.dirname(os.path.abspath(filename)), exist_ok=True)

application = defines["app"]
application_name = os.path.basename(application)
files = [application]
symlinks = {"Applications": "/Applications"}
icon = defines["icon"]
background = defines["background"]
icon_locations = {application_name: (180, 170), "Applications": (480, 170)}
window_rect = ((100, 100), (660, 400))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
icon_size = 128
text_size = 16
format = "UDZO"
filesystem = "HFS+"
