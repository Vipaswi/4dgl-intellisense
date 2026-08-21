// A library file reached through #inherit, to prove that functions defined here are
// visible to the name and argument-count checks in the file that inherits it.

func helper_DrawFrame(var x, var y)
    gfx_Rectangle(x, y, x + 10, y + 10, BLUE);
endfunc

func helper_Reset()
    gfx_Cls();
endfunc
