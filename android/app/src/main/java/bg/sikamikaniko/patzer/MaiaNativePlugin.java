package bg.sikamikaniko.patzer;

import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

@CapacitorPlugin(name = "MaiaNative")
public class MaiaNativePlugin extends Plugin {
  private OrtEnvironment env;
  private OrtSession session;

  @PluginMethod
  public void create(PluginCall call) {
    String modelPath = call.getString("modelPath", call.getString("path", ""));
    if (modelPath == null || modelPath.isEmpty()) {
      call.reject("modelPath is required");
      return;
    }
    try {
      closeSession();
      if (env == null) env = OrtEnvironment.getEnvironment();
      String resolved = resolvePath(modelPath);
      OrtSession.SessionOptions opts = new OrtSession.SessionOptions();
      try {
        opts.addNnapi();
      } catch (Throwable ignored) {
        // NNAPI is optional; ORT will fall back to CPU.
      }
      session = env.createSession(resolved, opts);
      call.resolve();
    } catch (Exception e) {
      call.reject("Failed to create Maia session: " + e.getMessage(), e);
    }
  }

  @PluginMethod
  public void run(PluginCall call) {
    if (session == null || env == null) {
      call.reject("Maia session is not created");
      return;
    }
    try {
      JSArray tokensArr = call.getArray("tokens");
      int selfElo = call.getInt("selfElo", 1400);
      int oppoElo = call.getInt("oppoElo", 1400);
      if (tokensArr == null) {
        call.reject("tokens is required");
        return;
      }

      int tokenCount = tokensArr.length();
      if (tokenCount <= 0 || tokenCount % 64 != 0) {
        call.reject("Invalid token tensor length: " + tokenCount);
        return;
      }
      int columns = tokenCount / 64;

      float[] tokenData = new float[tokenCount];
      for (int i = 0; i < tokenCount; i++) {
        tokenData[i] = (float) tokensArr.getDouble(i);
      }

      try (
        OnnxTensor tokensTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(tokenData), new long[] {1, 64, columns});
        OnnxTensor selfTensor = OnnxTensor.createTensor(env, LongBuffer.wrap(new long[] {selfElo}), new long[] {1});
        OnnxTensor oppoTensor = OnnxTensor.createTensor(env, LongBuffer.wrap(new long[] {oppoElo}), new long[] {1});
      ) {
        Map<String, OnnxTensor> inputs = new HashMap<>();
        inputs.put("tokens", tokensTensor);
        inputs.put("self_elos", selfTensor);
        inputs.put("oppo_elos", oppoTensor);

        try (OrtSession.Result result = session.run(inputs)) {
          float[] logitsMove = toFloatArray(result.get("logits_move").get().getValue());
          float[] logitsValue = toFloatArray(result.get("logits_value").get().getValue());
          float[] logitsPonder = toFloatArray(result.get("logits_ponder").get().getValue());

          JSObject ret = new JSObject();
          ret.put("logitsMove", toJSArray(logitsMove));
          ret.put("logitsValue", toJSArray(logitsValue));
          ret.put("logitsPonder", logitsPonder.length > 0 ? logitsPonder[0] : 0.0);
          call.resolve(ret);
        }
      }
    } catch (Exception e) {
      call.reject("Maia inference failed: " + e.getMessage(), e);
    }
  }

  @PluginMethod
  public void dispose(PluginCall call) {
    try {
      closeSession();
      call.resolve();
    } catch (Exception e) {
      call.reject("Failed to dispose Maia session: " + e.getMessage(), e);
    }
  }

  @Override
  protected void handleOnDestroy() {
    closeSession();
    super.handleOnDestroy();
  }

  private synchronized void closeSession() {
    if (session != null) {
      try { session.close(); } catch (Exception ignored) {}
      session = null;
    }
  }

  private String resolvePath(String path) throws Exception {
    if (path.startsWith("file://")) {
      Uri uri = Uri.parse(path);
      if (uri.getPath() != null) return uri.getPath();
    }
    if (path.startsWith("content://")) {
      // Best effort: try to derive a file path; callers should prefer file paths.
      Uri uri = Uri.parse(path);
      String p = uri.getPath();
      if (p != null) {
        File f = new File(p);
        if (f.exists()) return f.getAbsolutePath();
      }
      throw new IllegalArgumentException("content:// model paths are not supported; provide a filesystem path");
    }
    return path;
  }

  private static JSArray toJSArray(float[] values) {
    JSArray arr = new JSArray();
    for (float v : values) arr.put((double) v);
    return arr;
  }

  @SuppressWarnings("unchecked")
  private static float[] toFloatArray(Object value) {
    if (value instanceof float[]) return (float[]) value;
    if (value instanceof float[][]) return ((float[][]) value)[0];
    if (value instanceof float[][][]) {
      float[][][] v = (float[][][]) value;
      // Flatten [1, ...] outputs when needed.
      if (v.length == 1 && v[0].length > 0 && v[0][0] != null) {
        // Could be [1,1,n] or similar; flatten last dimension sequence.
        int total = 0;
        for (float[] inner : v[0]) total += inner.length;
        float[] flat = new float[total];
        int off = 0;
        for (float[] inner : v[0]) {
          System.arraycopy(inner, 0, flat, off, inner.length);
          off += inner.length;
        }
        return flat;
      }
    }
    if (value instanceof double[]) {
      double[] d = (double[]) value;
      float[] out = new float[d.length];
      for (int i = 0; i < d.length; i++) out[i] = (float) d[i];
      return out;
    }
    if (value instanceof Object[]) {
      // Handle boxed arrays conservatively.
      Object[] arr = (Object[]) value;
      if (arr.length == 1) return toFloatArray(arr[0]);
      float[] out = new float[arr.length];
      for (int i = 0; i < arr.length; i++) out[i] = ((Number) arr[i]).floatValue();
      return out;
    }
    throw new IllegalArgumentException("Unsupported ONNX output type: " + value.getClass());
  }
}
