# If something looks wrong

**The window isn't in its colour.**
Some colour themes or settings override it. Run **Vibespaces: Repaint All Spaces** (Ctrl+Shift+P, then type it).

**The space's window is on the plain VS Code taskbar button.**
Run **Vibespaces: Give This Window Its Own Taskbar Button**. The window blinks once and moves to its own button.

**The window went into the background after it blinked.**
That's Windows being careful about which window gets the focus. Click it once; it only happens when a space opens.

**My panels or terminal command didn't open.**
Check the space's editor (the gear) under *When this space opens*. A terminal command runs once per window, not
again when the window reloads.

**I want to see what Vibespaces did.**
Open **View > Output** and choose **Vibespaces** in the list on the right.

### Undo everything

1. Unpin any space buttons from the taskbar (right-click > **Unpin from taskbar**).
2. Press **Ctrl+Shift+X** to open Extensions, find Vibespaces, and click **Uninstall**.
3. Optional: delete the `Vibespaces` folder in your Documents folder. It holds only the small space files and their
   icons, never your projects.
