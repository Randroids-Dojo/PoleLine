package app.toyboxes.poleline;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // After the bridge has applied the game theme: draw under the system
        // bars and let the game lay itself out with the safe area insets.
        EdgeToEdge.enable(this);
    }
}
