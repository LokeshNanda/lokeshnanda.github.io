@echo off
rem SUPERSEDED by .github/workflows/weekly-note.yml (Sundays 20:04 IST in CI).
rem Keep this task unregistered while the Action is active: two compilers
rem would race for the same pending /inbox notes. Re-register only as a
rem fallback if CI is unavailable.
rem Weekly-learnings automation — run by Windows Task Scheduler (Sundays 20:04).
rem Safe to register on every laptop: stagger the trigger times so two
rem machines never push at once (inboxes are local, so content can't clash).
rem Compiles drafts/inbox.md into published learnings notes via the
rem weekly-note skill, headless. Logs to drafts\ (gitignored, stays local).
cd /d "%~dp0.."
if not exist drafts mkdir drafts
set "LOG=drafts\weekly-note-task.log"
echo ==== %date% %time% ==== >> "%LOG%"

rem Nothing captured this week on this machine? Skip without touching git.
if not exist "drafts\inbox.md" (
  echo Inbox missing - nothing to publish, skipping. >> "%LOG%"
  exit /b 0
)
findstr /r /c:"^### " "drafts\inbox.md" > nul
if errorlevel 1 (
  echo Inbox empty - nothing to publish, skipping. >> "%LOG%"
  exit /b 0
)

rem This repo lives on several machines: sync before publishing, or the
rem run would compile on a stale base and the final push would be rejected.
git pull --rebase origin main >> "%LOG%" 2>&1
if errorlevel 1 (
  echo git pull --rebase failed - aborting run, inbox left untouched. >> "%LOG%"
  git rebase --abort >> "%LOG%" 2>&1
  exit /b 1
)

"%USERPROFILE%\.local\bin\claude.exe" -p "/weekly-note" ^
  --allowedTools "Read,Write,Edit,Glob,Grep,Skill,Bash(node scripts/inbox-sync.mjs *),Bash(npm run build),Bash(git *),Bash(mv *),Bash(mkdir *),PowerShell(git *),PowerShell(npm run build)" ^
  < nul >> "%LOG%" 2>&1
