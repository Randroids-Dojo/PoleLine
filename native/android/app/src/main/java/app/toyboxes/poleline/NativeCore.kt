package app.toyboxes.poleline

object NativeCore {
    init { System.loadLibrary("poleline") }
    external fun catalog(): String
    external fun select(circuit: Int): String
    external fun touch(action: Int, x: Double, y: Double): String
    external fun race(circuit: Int, coordinates: DoubleArray, tyre: Int): String
}
