package bg.sikamikaniko.patzer;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(MaiaNativePlugin.class);
    registerPlugin(StockfishNativePlugin.class);
    super.onCreate(savedInstanceState);
  }
}
