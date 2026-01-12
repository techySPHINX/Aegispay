@echo off
REM AegisPay - Complete Validation Script (Windows)
REM This script runs all tests and benchmarks before pushing to GitHub

echo ======================================================================
echo 🎯 AegisPay Complete Validation
echo ======================================================================
echo.

REM Step 1: Install Dependencies
echo 📦 Step 1: Installing dependencies...
call pnpm install
if errorlevel 1 goto error
echo ✅ Dependencies installed
echo.

REM Step 2: Code Quality
echo 🔍 Step 2: Running code quality checks...
echo   - ESLint...
call pnpm run lint
if errorlevel 1 goto error
echo   - Prettier...
call pnpm run format:check
if errorlevel 1 goto error
echo   - TypeScript...
call pnpm run typecheck
if errorlevel 1 goto error
echo ✅ Code quality checks passed
echo.

REM Step 3: Build
echo 🔨 Step 3: Building project...
call pnpm run build
if errorlevel 1 goto error
echo ✅ Build successful
echo.

REM Step 4: Unit Tests
echo 🧪 Step 4: Running unit tests...
call pnpm run test:unit
if errorlevel 1 goto error
echo ✅ Unit tests passed
echo.

REM Step 5: Integration Tests
echo 🔗 Step 5: Running integration tests...
call pnpm run test:integration
if errorlevel 1 goto error
echo ✅ Integration tests passed
echo.

REM Step 6: E2E Tests
echo 🌐 Step 6: Running E2E tests...
call pnpm run test:e2e
echo ✅ E2E tests completed
echo.

REM Step 7: Test Coverage
echo 📊 Step 7: Generating test coverage report...
call pnpm run test:coverage
if errorlevel 1 goto error
echo ✅ Coverage report generated
echo.

REM Step 8: Benchmarks
echo ⚡ Step 8: Running performance benchmarks...
echo ⏱️  This may take 2-3 minutes...
call pnpm run benchmark
if errorlevel 1 goto error
echo ✅ Benchmarks completed
echo.

REM Final Summary
echo ======================================================================
echo 🎉 All validations passed!
echo ======================================================================
echo.
echo Summary:
echo   ✅ Code quality checks
echo   ✅ Build verification
echo   ✅ Unit tests
echo   ✅ Integration tests
echo   ✅ E2E tests
echo   ✅ Test coverage
echo   ✅ Performance benchmarks
echo.
echo Reports generated:
echo   📊 Coverage: coverage\lcov-report\index.html
echo   📊 Benchmarks: benchmark-reports\latest.md
echo.
echo 🚀 Ready to push to GitHub!
echo.
echo Next steps:
echo   1. Review coverage: start coverage\lcov-report\index.html
echo   2. Review benchmarks: type benchmark-reports\latest.md
echo   3. Commit changes: git add . ^&^& git commit -m "Add comprehensive testing"
echo   4. Push to GitHub: git push
echo.
goto end

:error
echo.
echo ❌ Validation failed!
echo Please fix the errors above and try again.
exit /b 1

:end
