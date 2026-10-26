// sudoku-game/shell.js - the links between the screens without import cycles: main.js fills APP with the functions
// of the home screen, dialogs and rooms; play.js, home.js and online.js call them.
//
//   APP.main() -> <main> element      APP.home()                APP.rules(variantId)       APP.settings()
//   APP.help()                         APP.share(game)           APP.exportGame(game)       APP.copy(text)
//   APP.invite(room)                   APP.chat(room)            APP.chatMessage(message)   APP.rematch(room)
//   APP.play(setup)                    APP.stats()

export const APP = {};
