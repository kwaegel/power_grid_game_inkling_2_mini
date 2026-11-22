# Task: build a browser-based power grid management game

You are going to design and build a complete, playable game that runs in a web browser, working on your own from start to finish. The work has three parts: set up and check the environment, build the game, then play-test it and write up what you did. Read this whole file before starting.

Build everything in the current working directory.

## Part 1: Environment setup and check (do this first)

You should be running inside a disposable sandbox virtual machine that exists only for this task. Inside it you have free rein: install whatever system packages, language toolchains, browsers and other tools you need, with `sudo` where required. Nothing in the sandbox needs protecting, and setting up your own tooling is part of the job.

Building this well depends on being able to run and play the game yourself in a real browser, and on being able to see it. So this part ends with a pass/fail decision. Some problems are yours to fix (a missing tool: install it). Others can only be fixed from outside the sandbox, and for those I want you to stop and tell me rather than work around them, because a workaround changes what you are able to build and test.

Two rules apply to every check:

- **Verify by running something.** A check passes only if you ran a command or tool call and saw the expected result. Don't mark anything as passing because it is usually present or because a related check passed.
- **Don't substitute.** A weaker stand-in does not count: a simulated DOM is not a browser engine, reading a file from disk is not fetching it from a server, and inspecting the DOM is not looking at the screen.

### Step 1: Confirm the sandbox, before installing anything

Check that the environment variable `AGENT_SANDBOX` is set to `1`. I set it when launching the sandbox. Also record your username, hostname, kernel version, and whether `/etc/sandbox-persistent.sh` exists, as supporting evidence.

If `AGENT_SANDBOX` is not `1`, stop immediately. Do not install anything or change anything outside the working directory, because you may be running on a real machine. Report this as a preflight failure as described below.

### Step 2: Set up and verify

Work through these in order. Install what is missing as you go.

1. **Working directory.** It is writable, and contains nothing except this prompt file (and possibly an empty git repository or your harness's own config directory).
2. **Install rights and network.** You can install a system package, and you can reach the package registries you intend to use. If a registry or download host is blocked, that is a failure only I can fix: record which hosts were refused.
3. **Git.** `git` is available. Initialise a repository here if there isn't one.
4. **Your toolchain.** Decide what you will build the game with, and install and verify it. Record the choice, your reasons, and the versions.
5. **Browser control.** Set up a way to drive a real browser engine (headless is fine), for example Playwright with its own Chromium, or a browser tool provided by your harness. Record the method and the browser's user-agent string. Through it you must be able to load a local URL, take a screenshot, send mouse clicks and keyboard input, run JavaScript in the page, and read console output and page errors.
6. **End-to-end smoke test.** In a scratch directory and using your chosen stack's real build path, produce a tiny page with a canvas that draws a coloured shape, a button that changes some text and logs to the console when clicked, and code that writes a value to `localStorage`. Serve it over HTTP on a local port, then through the browser: load it, take a screenshot, click the button, confirm the text changed, confirm you received the console message, reload, and confirm the `localStorage` value survived the reload. Every one of those steps has to succeed.
7. **Vision.** This confirms you can actually see images, which the rest of the task depends on.
   - Write a script that picks, at random and without printing them: a five-character code of uppercase letters and digits, a number of circles between 3 and 7, and a background colour from a list of at least six clearly different named colours. It renders a page showing the code in large text and the circles on that background, saves a screenshot through the browser as `vision-test.png`, and writes the true values to `vision-answer.json`. Nothing in its output may reveal the values.
   - Run it. Then open `vision-test.png` with your image-viewing capability and write down in `PREFLIGHT.md` the code, the number of circles, and the background colour as you see them.
   - Only after that, read `vision-answer.json` and compare.
   - The check passes only if all three match. If you have no way to view an image, or what you get back is not the image content, or any value is wrong, the check fails. Do not get the values any other way.

If something won't work, make a real attempt to fix it from inside the sandbox: read the error, install the missing dependency, try the documented fix. If it still fails after that, treat it as a failure rather than falling back to a weaker method.

### Step 3: Report and decide

Write the results to `PREFLIGHT.md`. For each check, include pass or fail, the command or tool call you used, and the relevant output (version strings, the fetched content, the console message, the stored value, the vision comparison). Also list everything you installed.

- **If every check passes:** delete the scratch files, commit, and carry on to Part 2 without waiting for me.
- **If any check fails:** run the remaining checks anyway where it is safe to, so the report is complete (if the sandbox check failed, run nothing further). Finish writing `PREFLIGHT.md`, then end your turn with a message that begins with `PREFLIGHT FAILED`, lists what failed, and says what I would need to change. Do not write any game code.

## Part 2: The game

The player runs the electricity grid for a small region, keeping supply matched to demand while conditions get steadily harder. Beyond the points below, the design is yours. I am interested in the choices you make, so treat these as a brief, and make the rest of the decisions the way a game designer would.

What it needs:

- **Runs in the browser, client-side only.** No backend, and no network access needed once the page is served. A single documented command builds and serves it from a clean checkout, on a machine that has your toolchain installed. Target a desktop browser with a mouse; keyboard shortcuts are optional.
- **Cute, soft look.** Rounded shapes, a gentle palette, friendly rather than industrial. Make the visuals yourself (canvas, SVG, CSS, generated in code); don't download art or asset packs.
- **Several power plant types** with meaningfully different tradeoffs, so that choosing between them is an interesting decision and no single type is always the right answer.
- **Seasonal demand.** Electricity use follows patterns over the year that a player can learn and plan around.
- **Random disasters** that the player has to respond to. They should create decisions and reward preparation, and be survivable with good play.
- **Rising difficulty.** The game gets harder the longer a run lasts, and a run eventually ends.
- **A score** based on some combination of how long the player lasted, how much power they delivered, or similar measures of your choosing. Show it at the end of a run and keep a local list of best scores.
- **Saved games** in web storage that survive a page reload, plus a way to export a save to a file and import it again.
- **Learnable by playing.** Someone opening it cold should understand what to do within a couple of minutes without reading documentation.

What is open: everything else. Real-time or turn-based, a map or something more abstract, money, energy storage, transmission, weather, research, customer satisfaction, sound, how a run ends. The language, build tooling and libraries are your choice too; use the stack you chose in Part 1, and if you change your mind later, say so and why in `NOTES.md`. A small game where every system works and the whole thing is fun beats a large one with half-finished systems.

## Part 3: Play-test and write up

Once the game runs, play it through the browser the way a player would, and fix what you find. Looking at the game is part of this: a game can pass every scripted check and still have overlapping panels, unreadable text, or art that doesn't match the brief, and only viewing screenshots will show that.

At a minimum:

- Start a new game, build things, get through several seasons, live through at least one disaster, lose, and see the score.
- Take and view screenshots at each of those points, and after any change to layout or art. Judge them as a player would: is it readable, does anything overlap or overflow, does it look cute and soft, is it clear what to do next? Fix what you see.
- Save, reload the page, and continue. Export a save, clear storage, import it, and continue.
- Watch the console for errors throughout.
- Check the balance at both ends: a careless player should lose, and a careful one should last well past the opening minutes.
- Confirm the documented command works from a clean checkout of the repository.

Then leave these in the repository:

- `README.md`: how to run the game (including what needs to be installed) and how to play it.
- `NOTES.md`: the main design decisions and why you made them, what you tested and how, what you changed as a result of looking at screenshots, known problems, and what you would do next with more time.
- `screenshots/`: a handful of final screenshots covering the start of a game, mid-game, a disaster, and the game-over screen.

Commit as you go with messages that describe the change.

## How to work

- After the environment check passes, work autonomously to the end. Don't stop to ask me questions; when something is ambiguous, decide, and record the decision in `NOTES.md`.
- Report accurately. If something is untested, partly working, or broken, say so plainly in `NOTES.md` and in your final message.
- End with a short final message: what you built, the command to run it, and any known issues.
