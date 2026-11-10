# What a space is

If you work on more than one project, VS Code windows start to look alike, and on the taskbar they all pile up
under one blue icon. A **space** fixes that.

A space is one of your projects, set up so that it:

- **opens in its own window**, with its title bar and bottom bar in the project's colour;
- **gets its own button on the Windows taskbar**, in that colour, which you can pin;
- **remembers how you left it**: the files you had open, and the panels you like to see.

### A few words you'll see

| Word | What it means |
|---|---|
| **Folder** | Where your project's files live on your computer, like `Documents\My Website`. |
| **Window** | One VS Code window. Each space opens in its own. |
| **Space** | A project set up with Vibespaces: a name, a colour, and the folder (or folders) it opens. |
| **Side bar** | The panel down the left side of VS Code. The Vibespaces list lives there. |

Under the hood, a space is a small file (a *workspace file*) in `Documents\Vibespaces`. You never have to
open it: Vibespaces has a form for everything. Deleting a space deletes only that small file, never your project.
