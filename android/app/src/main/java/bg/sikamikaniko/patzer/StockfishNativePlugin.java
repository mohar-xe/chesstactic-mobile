package bg.sikamikaniko.patzer;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "StockfishNative")
public class StockfishNativePlugin extends Plugin {
  private Process process;
  private BufferedWriter stdin;
  private BufferedReader stdout;
  private final Object engineLock = new Object();

  @PluginMethod
  public void start(PluginCall call) {
    synchronized (engineLock) {
      try {
        if (process != null && process.isAlive()) {
          call.resolve();
          return;
        }
        File bin = resolveStockfishBinary();
        if (bin == null || !bin.exists()) {
          call.reject("Stockfish binary not found. Bundle libstockfish.so for the device ABI.");
          return;
        }
        bin.setExecutable(true, false);
        ProcessBuilder pb = new ProcessBuilder(bin.getAbsolutePath());
        pb.redirectErrorStream(true);
        process = pb.start();
        stdin = new BufferedWriter(new OutputStreamWriter(process.getOutputStream()));
        stdout = new BufferedReader(new InputStreamReader(process.getInputStream()));
        send("uci");
        readUntil("uciok", 5000);
        send("isready");
        readUntil("readyok", 5000);
        call.resolve();
      } catch (Exception e) {
        stopProcessQuietly();
        call.reject("Failed to start Stockfish: " + e.getMessage(), e);
      }
    }
  }

  @PluginMethod
  public void analyze(PluginCall call) {
    String fen = call.getString("fen", "");
    int depth = call.getInt("depth", 12);
    int movetimeMs = call.getInt("movetimeMs", 0);
    int multiPv = Math.max(1, call.getInt("multiPv", 1));
    if (fen == null || fen.isEmpty()) {
      call.reject("fen is required");
      return;
    }

    synchronized (engineLock) {
      if (process == null || !process.isAlive() || stdin == null || stdout == null) {
        call.reject("Stockfish is not running");
        return;
      }
      try {
        send("stop");
        send("isready");
        readUntil("readyok", 5000);
        send("setoption name MultiPV value " + multiPv);
        send("ucinewgame");
        send("position fen " + fen);

        StringBuilder go = new StringBuilder("go");
        if (movetimeMs > 0) go.append(" movetime ").append(movetimeMs);
        else go.append(" depth ").append(Math.max(1, depth));
        send(go.toString());

        Map<Integer, JSObject> latest = new HashMap<>();
        String bestMove = null;
        long deadline = System.currentTimeMillis() + Math.max(1500, (movetimeMs > 0 ? movetimeMs : depth * 500L) + 5000L);

        while (System.currentTimeMillis() < deadline) {
          String line = stdout.readLine();
          if (line == null) break;
          line = line.trim();
          if (line.startsWith("info ")) {
            ParsedInfo info = parseInfo(line);
            if (info != null) {
              JSObject obj = new JSObject();
              obj.put("cp", info.cp);
              if (info.mate == null) obj.put("mate", JSObject.NULL);
              else obj.put("mate", info.mate);
              JSArray pv = new JSArray();
              for (String m : info.pv) pv.put(m);
              obj.put("pv", pv);
              obj.put("bestMove", info.pv.isEmpty() ? JSObject.NULL : info.pv.get(0));
              latest.put(info.multipv, obj);
            }
          } else if (line.startsWith("bestmove")) {
            String[] parts = line.split("\\s+");
            if (parts.length >= 2 && !"(none)".equals(parts[1])) bestMove = parts[1];
            break;
          }
        }

        JSArray lines = new JSArray();
        for (int i = 1; i <= multiPv; i++) {
          JSObject obj = latest.get(i);
          if (obj == null) continue;
          if (i == 1 && bestMove != null) obj.put("bestMove", bestMove);
          lines.put(obj);
        }
        if (lines.length() == 0 && bestMove != null) {
          JSObject obj = new JSObject();
          obj.put("cp", 0);
          obj.put("mate", JSObject.NULL);
          JSArray pv = new JSArray();
          pv.put(bestMove);
          obj.put("pv", pv);
          obj.put("bestMove", bestMove);
          lines.put(obj);
        }

        JSObject ret = new JSObject();
        ret.put("lines", lines);
        call.resolve(ret);
      } catch (Exception e) {
        call.reject("Stockfish analysis failed: " + e.getMessage(), e);
      }
    }
  }

  @PluginMethod
  public void quit(PluginCall call) {
    synchronized (engineLock) {
      stopProcessQuietly();
      call.resolve();
    }
  }

  @Override
  protected void handleOnDestroy() {
    synchronized (engineLock) {
      stopProcessQuietly();
    }
    super.handleOnDestroy();
  }

  private void send(String cmd) throws Exception {
    stdin.write(cmd);
    stdin.write("\n");
    stdin.flush();
  }

  private void readUntil(String token, long timeoutMs) throws Exception {
    long deadline = System.currentTimeMillis() + timeoutMs;
    while (System.currentTimeMillis() < deadline) {
      String line = stdout.readLine();
      if (line == null) break;
      if (line.contains(token)) return;
    }
  }

  private void stopProcessQuietly() {
    try { if (stdin != null) { send("quit"); } } catch (Exception ignored) {}
    try { if (stdin != null) stdin.close(); } catch (Exception ignored) {}
    try { if (stdout != null) stdout.close(); } catch (Exception ignored) {}
    if (process != null) {
      try {
        process.destroy();
        if (!process.waitFor(500, TimeUnit.MILLISECONDS)) process.destroyForcibly();
      } catch (Exception ignored) {}
      process = null;
    }
    stdin = null;
    stdout = null;
  }

  private File resolveStockfishBinary() {
    // Prefer bundled native library (android/app/src/main/jniLibs/<abi>/libstockfish.so).
    String nativeDir = getContext().getApplicationInfo().nativeLibraryDir;
    if (nativeDir != null) {
      File lib = new File(nativeDir, "libstockfish.so");
      if (lib.exists()) return lib;
    }
    // Fallback: executable named "stockfish" in native lib dir.
    if (nativeDir != null) {
      File exe = new File(nativeDir, "stockfish");
      if (exe.exists()) return exe;
    }
    // Fallback: app files dir.
    File files = new File(getContext().getFilesDir(), "stockfish");
    if (files.exists()) return files;
    return null;
  }

  private static class ParsedInfo {
    int multipv = 1;
    int cp = 0;
    Integer mate = null;
    List<String> pv = new ArrayList<>();
  }

  private static ParsedInfo parseInfo(String line) {
    // Ignore partial/upperbound/lowerbound lines for simplicity.
    if (line.contains(" upperbound") || line.contains(" lowerbound")) return null;
    String[] parts = line.split("\\s+");
    ParsedInfo info = new ParsedInfo();
    boolean sawScore = false;
    for (int i = 1; i < parts.length; i++) {
      String p = parts[i];
      if ("multipv".equals(p) && i + 1 < parts.length) {
        try { info.multipv = Integer.parseInt(parts[++i]); } catch (Exception ignored) {}
      } else if ("score".equals(p) && i + 2 < parts.length) {
        String kind = parts[++i];
        String val = parts[++i];
        try {
          if ("cp".equals(kind)) { info.cp = Integer.parseInt(val); info.mate = null; }
          else if ("mate".equals(kind)) { info.mate = Integer.parseInt(val); info.cp = 0; }
          sawScore = true;
        } catch (Exception ignored) {}
      } else if ("pv".equals(p)) {
        for (int j = i + 1; j < parts.length; j++) info.pv.add(parts[j]);
        break;
      }
    }
    if (!sawScore) return null;
    return info;
  }
}
